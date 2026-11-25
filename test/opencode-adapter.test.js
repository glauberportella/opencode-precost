import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrecostPlugin } from '../adapters/opencode/index.js';

const mk = async (opt = {}) => PrecostPlugin({}, { historyPath: join(mkdtempSync(join(tmpdir(), 'oc-')), 'h.json'), ...opt });
const asst = (id, cost, input, output) => ({ type: 'message.updated', properties: { info: { id, sessionID: 's1', role: 'assistant', time: { created: 1, completed: 2 }, cost, tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } } } } });

test('tool precost_estimate devolve previa', async () => {
  const p = await mk({ models: ['gemini-4-hydrogen'] });
  const out = await p.tool.precost_estimate.execute({ task: 'adicionar testes' }, {});
  assert.match(String(out.output ?? out), /OBSERVADO/);
});
test('evento acumula gasto real, dedup por id; tool.execute.before bloqueia acima do limite', async () => {
  const p = await mk({ sessionLimitUsd: 1 });
  await p.event({ event: asst('m1', 0.6, 1000, 100) });
  await p.event({ event: asst('m1', 0.6, 1000, 100) }); // repetido
  await p['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c' }, { args: {} }); // 0.6 <= 1 passa
  await p.event({ event: asst('m2', 0.7, 1000, 100) });
  await assert.rejects(p['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c2' }, { args: {} }), /passou do limite/);
});

import { writeFileSync, mkdirSync } from 'node:fs';
const gate = async (opt = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'oc-g-'));
  return { d, p: await PrecostPlugin({ directory: d }, { historyPath: join(d, 'h.json'), stateDir: join(d, 'st'), limitUsd: 20, version: '1.19.6', ...opt }) };
};
const msg = (text, extra = []) => [{ sessionID: 's1', model: { providerID: 'google', modelID: 'gemini-3.5-flash' } }, { parts: [{ type: 'text', text }, ...extra] }];
const codeIn = (e) => /precost approve ([0-9a-f]{8})/.exec(e.message)[1];
const blockedWith = async (p, ...a) => { try { await p['chat.message'](...a); return null; } catch (e) { return e; } };

test('chat.message: bloqueia, resend nao aprova, approve (do usuario) + reenvio libera uma vez, revoke desfaz', async () => {
  const { p } = await gate({ limitUsd: 0.5 });
  const big = 'x'.repeat(2_000_000);
  const e1 = await blockedWith(p, ...msg(big)); assert.match(e1.message, /BLOQUEADO/);
  assert.ok(await blockedWith(p, ...msg(big)));
  assert.match((await blockedWith(p, ...msg(`precost approve ${codeIn(e1)}`))).message, /aprovado/);
  assert.equal(await blockedWith(p, ...msg(big)), null);   // liberado
  assert.ok(await blockedWith(p, ...msg(big)));            // uso unico
  const e2 = await blockedWith(p, ...msg(big)); await blockedWith(p, ...msg(`precost approve ${codeIn(e2)}`));
  await blockedWith(p, ...msg('precost revoke all'));
  assert.ok(await blockedWith(p, ...msg(big)));            // revogado depois de aprovado
});
test('falha fechada: limite string, versao diferente, versao nao identificada; allowUnverifiedVersion libera so a versao', async () => {
  assert.match((await blockedWith((await gate({ limitUsd: '0.5' })).p, ...msg('oi'))).message, /invalida/);
  assert.match((await blockedWith((await gate({ version: '1.20.0' })).p, ...msg('oi'))).message, /difere da verificada/);
  const none = await PrecostPlugin({ directory: '/tmp', serverUrl: new URL('http://127.0.0.1:1') }, { stateDir: '/tmp/st-x', limitUsd: 0.5, historyPath: '/tmp/h-x.json' });
  assert.match((await blockedWith(none, ...msg('oi'))).message, /nao identificada/);
  assert.equal(await blockedWith((await gate({ version: '1.20.0', allowUnverifiedVersion: true })).p, ...msg('oi')), null);
  assert.equal(await blockedWith((await gate()).p, ...msg('oi')), null); // controle positivo: pequeno e permitido
});
test('arquivo anexado (parte file) entra no custo e no vinculo', async () => {
  const { d, p } = await gate();
  writeFileSync(join(d, 'grande.txt'), 'z'.repeat(900_000));
  const fp = { type: 'file', url: new URL(`file://${d}/grande.txt`).href, mime: 'text/plain' };
  const e = await blockedWith(p, ...msg('analise', [fp])); assert.match(e.message, /grande\.txt \(900000 bytes\)/);
  assert.equal(await blockedWith((await gate()).p, ...msg('analise')), null); // sem o arquivo cabe
  await blockedWith(p, ...msg(`precost approve ${codeIn(e)}`));
  writeFileSync(join(d, 'grande.txt'), 'w'.repeat(900_000));
  assert.ok(await blockedWith(p, ...msg('analise', [fp]))); // arquivo mudou
});
test('ledger: dedup por id persiste apos reinicio e nao duplica gasto', async () => {
  const d = mkdtempSync(join(tmpdir(), 'oc-l-')); const hp = join(d, 'h.json');
  const a = await PrecostPlugin({}, { historyPath: hp }); await a.event({ event: asst('m1', 0.6, 1000, 100) });
  const b = await PrecostPlugin({}, { historyPath: hp, sessionLimitUsd: 1 });
  await b.event({ event: asst('m1', 0.6, 1000, 100) });      // mesmo id depois de reiniciar
  await b['tool.execute.before']({ tool: 'bash', sessionID: 's1' }, {}); // 0.6, nao 1.2
  await assert.rejects((await PrecostPlugin({}, { historyPath: hp, sessionLimitUsd: 'x' }))['tool.execute.before']({ sessionID: 's1' }, {}), /invalido/);
});

test('ledger registra pico real de contexto por chamada e o historico o usa', async () => {
  const d = mkdtempSync(join(tmpdir(), 'oc-pk-')); const L = new (await import('../src/history.js')).SessionLedger(join(d, 'h.json'));
  L.record({ id: 'a', sessionID: 's', cost: 0.1, tokens: { input: 50_000, output: 10, cache: { read: 20_000, write: 0 } } });
  L.record({ id: 'b', sessionID: 's', cost: 0.1, tokens: { input: 300_000, output: 10, cache: { read: 0, write: 0 } } });
  L.record({ id: 'b', sessionID: 's', cost: 0.1, tokens: { input: 300_000, output: 10, cache: { read: 0, write: 0 } } }); // reenvio do mesmo id
  assert.equal(L.list()[0].peakCtx, 300_000); assert.equal(L.list()[0].turns, 2);
});

test('historico do plugin so usa sessoes do mesmo modelo e projeto; mistura nao entra', async () => {
  const d = mkdtempSync(join(tmpdir(), 'oc-h-')); const hp = join(d, 'h.json');
  const P = (dir, opt = {}) => PrecostPlugin({ directory: dir }, { historyPath: hp, models: ['gemini-3.5-flash'], ...opt });
  const rec = async (p, sess, model, n) => { for (let i = 0; i < 2; i++) await p.event({ event: { type: 'message.updated', properties: { info: { id: `${sess}-${i}`, sessionID: sess, role: 'assistant', modelID: model, time: { created: 1, completed: 2 }, cost: 0, tokens: { input: 1000 * n, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } } } } }); };
  const pa = await P('/proj/a');
  for (let i = 0; i < 5; i++) await rec(pa, `a${i}`, 'gemini-3.5-flash', 10);
  for (let i = 0; i < 5; i++) await rec(pa, `m${i}`, 'outro-modelo', 10);
  const est = async (dir) => { const r = await (await P(dir)).tool.precost_estimate.execute({ task: 'x' }, {}); return String(r.output ?? r); };
  const out = await est('/proj/a');
  assert.match(out, /base: historico/);
  const other = await est('/proj/b');
  assert.match(other, /base: premissas/); // outro projeto: sem historico
});

test('regressao: partes so com arquivo (sem texto) passam pelo gate; vazio sem arquivo nao', async () => {
  const { d, p } = await gate();
  writeFileSync(join(d, 'g.txt'), 'z'.repeat(900_000));
  const fp = { type: 'file', url: new URL(`file://${d}/g.txt`).href, mime: 'text/plain' };
  const e = await blockedWith(p, { sessionID: 's1', model: { modelID: 'gemini-3.5-flash' } }, { parts: [fp] });
  assert.match(e.message, /BLOQUEADO/); assert.match(e.message, /g\.txt \(900000 bytes\)/);
  assert.equal(await blockedWith(p, { sessionID: 's1', model: { modelID: 'gemini-3.5-flash' } }, { parts: [] }), null);
});
test('regressao: comandos precost sao interceptados SEMPRE (sem limitUsd tambem) e prompt comum passa', async () => {
  const { p } = await gate({ limitUsd: undefined });
  for (const c of ['precost estimate tarefa x', 'precost last', 'precost approve deadbeef', 'precost revoke all']) {
    const e = await blockedWith(p, ...msg(c)); assert.ok(e, c); assert.equal(e.precostDeny, true);
  }
  assert.match((await blockedWith(p, ...msg('precost estimate tarefa x'))).message, /Nada foi enviado ao modelo/);
  assert.equal(await blockedWith(p, ...msg('prompt comum')), null);
});
test('regressao: comparacao nao mistura historico entre modelos; cada linha usa o seu', async () => {
  const d = mkdtempSync(join(tmpdir(), 'oc-c-')); const hp = join(d, 'h.json');
  const P = () => PrecostPlugin({ directory: '/proj/a' }, { historyPath: hp, models: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'] });
  const p0 = await P();
  for (let i = 0; i < 5; i++) await p0.event({ event: { type: 'message.updated', properties: { info: { id: `x${i}`, sessionID: `x${i}`, role: 'assistant', modelID: 'gemini-3.5-flash', time: { created: 1, completed: 2 }, cost: 0, tokens: { input: 1000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } } } } });
  const r = await (await P()).tool.precost_estimate.execute({ task: 'x' }, {}); const out = String(r.output ?? r);
  assert.match(out, /gemini-3\.5-flash \[base: historico\]/); assert.match(out, /gemini-3\.5-flash-lite \[base: premissas\]/);
});

test('regressao do revisor: mesmo ledger (3.7 ~10k, 3.8 ~400k) em tool, gate com compare e preview: cada modelo usa so o seu historico', async () => {
  const d = mkdtempSync(join(tmpdir(), 'oc-r-')); const hp = join(d, 'h.json');
  const mkp = (opt = {}) => PrecostPlugin({ directory: '/proj/a' }, { historyPath: hp, stateDir: join(d, 'st'), version: '1.19.6', models: ['gemini-3.7-flash', 'gemini-3.8-flash'], compare: ['gemini-3.8-flash'], ...opt });
  const p0 = await mkp();
  const ev = (id, model, n) => p0.event({ event: { type: 'message.updated', properties: { info: { id, sessionID: id, role: 'assistant', modelID: model, time: { created: 1, completed: 2 }, cost: 0, tokens: { input: n, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } } } } });
  for (let i = 0; i < 6; i++) { await ev(`a${i}`, 'gemini-3.7-flash', 10_000); await ev(`b${i}`, 'gemini-3.8-flash', 400_000); }
  const usdOf = (txt, model) => { const m = new RegExp(`- ${model.replace('.', '\\.')}[^\\n]*?tarefa (?:AO MENOS )?US\\$([0-9.]+)`).exec(txt); assert.ok(m, `sem linha de ${model} em: ${txt.slice(0, 600)}`); return Number(m[1]); };
  const tr = await (await mkp()).tool.precost_estimate.execute({ task: 'x' }, {}); const t = String(tr.output ?? tr);
  const g = (await blockedWith(await mkp({ limitUsd: 0.0001 }), { sessionID: 's9', model: { modelID: 'gemini-3.7-flash' } }, { parts: [{ type: 'text', text: 'x' }] })).message;
  const pv = (await blockedWith(await mkp({ limitUsd: 0.0001 }), { sessionID: 's9', model: { modelID: 'gemini-3.7-flash' } }, { parts: [{ type: 'text', text: 'precost estimate x' }] })).message;
  for (const out of [t, g, pv]) {
    assert.ok(usdOf(out, 'gemini-3.8-flash') > 20 * usdOf(out, 'gemini-3.7-flash'), out.slice(0, 400)); // 3.8 (400k) bem acima de 3.7 (10k)
    assert.match(out, /base: historico/); assert.doesNotMatch(out, /base: premissas/);
  }
});
