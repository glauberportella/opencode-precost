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
