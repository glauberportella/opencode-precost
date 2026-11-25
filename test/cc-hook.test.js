import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = new URL('../adapters/claude-code/userpromptsubmit.js', import.meta.url).pathname;
const tracker = new URL('../adapters/claude-code/track-model.js', import.meta.url).pathname;
const mkenv = (cfg) => { const dir = mkdtempSync(join(tmpdir(), 'pc-')); const c = join(dir, 'c.json'); writeFileSync(c, JSON.stringify(cfg)); return { dir, c, st: join(dir, 'st') }; };
const submit = (e, prompt, session = 's1', extraEnv = {}) => {
  const r = spawnSync('node', [hook], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt }), env: { ...process.env, PRECOST_CONFIG: e.c, PRECOST_STATE: e.st, ...extraEnv }, encoding: 'utf8' });
  assert.equal(r.status, 0); return r.stdout ? JSON.parse(r.stdout) : null;
};
const codeOf = (o) => /precost approve ([0-9a-f]{8})/.exec(o.reason)[1];
const CFG = { model: 'gemini-4-neon', limitUsd: 0.5, ttlMin: 10 };

test('contrato de saida (doc): bloqueio = decision block + reason string; permissao = so systemMessage', () => {
  const e = mkenv(CFG);
  const b = submit(e, 'refatorar tudo');
  assert.equal(b.decision, 'block'); assert.equal(typeof b.reason, 'string');
  assert.equal(b.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(b.reason.length < 10000); // limite documentado de 10.000 caracteres
  const e2 = mkenv({ ...CFG, model: 'claude-sonnet-5.5', limitUsd: 1000 });
  const ok = submit(e2, 'refatorar tudo');
  assert.equal(ok.decision, undefined); assert.match(ok.systemMessage, /ESTIMATIVA/);
});
test('reenviar o MESMO prompt nunca aprova (nem varias vezes)', () => {
  const e = mkenv(CFG);
  for (let i = 0; i < 3; i++) assert.equal(submit(e, 'refatorar tudo').decision, 'block');
});
test('ciclo completo: bloqueio -> approve -> reenvio permitido -> uso unico', () => {
  const e = mkenv(CFG);
  const code = codeOf(submit(e, 'refatorar tudo'));
  const a = submit(e, `precost approve ${code}`);
  assert.equal(a.decision, 'block'); assert.match(a.reason, /aprovado/); // o comando em si nao vai ao modelo
  const ok = submit(e, 'refatorar tudo');
  assert.equal(ok.decision, undefined); assert.match(ok.systemMessage, /consumida/);
  assert.equal(submit(e, 'refatorar tudo').decision, 'block'); // uso unico
  assert.match(submit(e, `precost approve ${code}`).reason, /desconhecido|expirado|usado/); // codigo nao reutiliza
});
test('vinculo: variante e recusada e a aprovacao original continua valida (controle positivo)', () => {
  const e = mkenv(CFG);
  const approve = (prompt, session = 's1', env = {}) => { submit(e, 'precost revoke all'); const c = codeOf(submit(e, prompt, session, env)); submit(e, `precost approve ${c}`, session, env); };
  const variants = [
    ['outro prompt', () => submit(e, 'tarefa B')],
    ['outro modelo', () => submit(e, 'tarefa A', 's1', { PRECOST_MODEL: 'gemini-4-carbon' })],
    ['outra sessao', () => submit(e, 'tarefa A', 's2')],
  ];
  for (const [nome, v] of variants) {
    approve('tarefa A');
    assert.equal(v().decision, 'block', nome);
    const original = submit(e, 'tarefa A');
    assert.equal(original.decision, undefined, `${nome}: aprovacao original deveria seguir valida`);
  }
  // tabela de precos e limite mudam o vinculo
  const alt = join(e.dir, 'p.json'); const p = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url))); p.models['gemini-4-neon'].input = 3.5; writeFileSync(alt, JSON.stringify(p));
  for (const [nome, cfg2] of [['tabela de precos', { ...CFG, prices: alt }], ['limite', { ...CFG, limitUsd: 0.4 }]]) {
    approve('tarefa A');
    writeFileSync(e.c, JSON.stringify(cfg2));
    assert.equal(submit(e, 'tarefa A').decision, 'block', nome);
    writeFileSync(e.c, JSON.stringify(CFG));
    assert.equal(submit(e, 'tarefa A').decision, undefined, `${nome}: aprovacao original deveria seguir valida`);
  }
});
test('approve de outra sessao nao vale; codigo errado nao aprova', () => {
  const e = mkenv(CFG);
  const code = codeOf(submit(e, 'tarefa A', 's1'));
  assert.match(submit(e, `precost approve ${code}`, 's2').reason, /outra sessao/);
  assert.match(submit(e, 'precost approve deadbeef', 's1').reason, /desconhecido/);
  assert.equal(submit(e, 'tarefa A', 's1').decision, 'block');
});
test('expiracao: aprovacao vencida nao vale', () => {
  const e = mkenv({ ...CFG, ttlMin: 0.0001 });
  const code = codeOf(submit(e, 'tarefa A'));
  const a = submit(e, `precost approve ${code}`);
  assert.ok(a.reason); // com ttl 0 expira na hora (pendencia pode ja estar vencida)
  assert.equal(submit(e, 'tarefa A').decision, 'block');
});
test('revogacao: approve seguido de revoke impede o reenvio', () => {
  const e = mkenv(CFG);
  const code = codeOf(submit(e, 'tarefa A'));
  submit(e, `precost approve ${code}`);
  assert.match(submit(e, 'precost revoke all').reason, /revogada/);
  assert.equal(submit(e, 'tarefa A').decision, 'block');
});
test('modelo ativo desconhecido COM limite: falha fechada (bloqueia e diz por que); sem limite: informativo com SEM GATE', () => {
  const e = mkenv({ limitUsd: 0.01 });
  const o = submit(e, 'qualquer');
  assert.equal(o.decision, 'block'); assert.match(o.reason, /nao pode ser avaliado/);
  const c = codeOf(o); submit(e, `precost approve ${c}`);
  assert.equal(submit(e, 'qualquer').decision, undefined); // aprovacao explicita libera uma vez
  const e2 = mkenv({ model: 'gemini-4-neon' });
  assert.match(submit(e2, 'x').systemMessage, /SEM GATE/);
});
test('falha fechada: limite como string, config ilegivel, ttl invalido, modelo sem preco', () => {
  for (const cfg of [{ model: 'gemini-4-neon', limitUsd: '0.5' }, { model: 'gemini-4-neon', limitUsd: 0.5, ttlMin: 'x' }, { model: 'gemini-4-neon', limitUsd: -1 }]) {
    const o = submit(mkenv(cfg), 'x'); assert.equal(o.decision, 'block', JSON.stringify(cfg)); assert.match(o.reason, /invalida/);
  }
  const e = mkenv({}); writeFileSync(e.c, '{quebrado');
  assert.match(submit(e, 'x').reason, /ilegivel/);
  assert.match(submit(mkenv({ model: 'modelo-inexistente', limitUsd: 5 }), 'x').reason, /sem preco/);
});
test('revogar DEPOIS de aprovar remove a concessao (regressao); revogar por codigo; outro codigo nao revoga', () => {
  const e = mkenv(CFG);
  const c1 = codeOf(submit(e, 'tarefa A')); submit(e, `precost approve ${c1}`);
  assert.match(submit(e, 'precost revoke deadbeef').reason, /0 pendencia/);
  assert.equal(submit(e, 'tarefa A').decision, undefined); // controle positivo: concessao seguia valida
  const c2 = codeOf(submit(e, 'tarefa A')); submit(e, `precost approve ${c2}`);
  assert.match(submit(e, `precost revoke ${c2}`).reason, /1 pendencia/);
  assert.equal(submit(e, 'tarefa A').decision, 'block');
});
test('arquivos @ entram no custo e no vinculo; mudar o arquivo derruba a aprovacao; fora do projeto/segredo nao e lido e exige aprovacao', () => {
  const e = mkenv(CFG); const proj = join(e.dir, 'proj'); mkdirSync(proj);
  writeFileSync(join(proj, 'a.txt'), 'x'.repeat(40000)); writeFileSync(join(proj, '.env'), 'SEGREDO=1');
  const run = (prompt) => { const r = spawnSync('node', [hook], { input: JSON.stringify({ session_id: 's1', prompt, cwd: proj }), env: { ...process.env, PRECOST_CONFIG: e.c, PRECOST_STATE: e.st }, encoding: 'utf8' }); return JSON.parse(r.stdout); };
  const b = run('veja @a.txt'); assert.match(b.reason, /arquivos 40000/); assert.match(b.reason, /a\.txt \(40000 bytes\)/);
  run(`precost approve ${codeOf(b)}`);
  writeFileSync(join(proj, 'a.txt'), 'y'.repeat(40000)); // mesmo tamanho, conteudo diferente
  assert.equal(run('veja @a.txt').decision, 'block');
  const ok = (() => { const c = codeOf(run('veja @a.txt')); run(`precost approve ${c}`); return run('veja @a.txt'); })();
  assert.equal(ok.decision, undefined); // controle positivo
  const s = run('veja @.env e @../fora.txt'); assert.match(s.reason, /NAO contado/);
  assert.doesNotMatch(s.reason, /SEGREDO/);
});
test('rastreador: SessionStart.model e PostModelSwitch.to_model definem o modelo da sessao', () => {
  const e = mkenv({ limitUsd: 1000 });
  const run = (ev) => spawnSync('node', [tracker], { input: JSON.stringify(ev), env: { ...process.env, PRECOST_STATE: e.st } });
  run({ hook_event_name: 'SessionStart', session_id: 's1', model: 'claude-sonnet-5.5' });
  assert.match(submit(e, 'x', 's1').systemMessage, /modelo ativo: claude-sonnet-5.5/);
  run({ hook_event_name: 'PostModelSwitch', session_id: 's1', from_model: 'claude-sonnet-5.5', to_model: 'claude-opus-5.5' });
  assert.match(submit(e, 'x', 's1').systemMessage, /modelo ativo: claude-opus-5.5/);
});
test('stdin invalido: exit 0; sem config so avisa; com limite configurado bloqueia', () => {
  const r = spawnSync('node', [hook], { input: 'nao-json', encoding: 'utf8', env: { ...process.env, PRECOST_CONFIG: '/nao/existe', PRECOST_STATE: '/tmp/x' } });
  assert.equal(r.status, 0); assert.match(JSON.parse(r.stdout).systemMessage, /ilegivel/);
  const e = mkenv(CFG);
  const r2 = spawnSync('node', [hook], { input: 'nao-json', encoding: 'utf8', env: { ...process.env, PRECOST_CONFIG: e.c, PRECOST_STATE: e.st } });
  assert.equal(JSON.parse(r2.stdout).decision, 'block');
});
test('precost estimate/last: previa sob demanda sem modelo e sem aprovar nada', () => {
  const e = mkenv(CFG);
  const p = submit(e, 'precost estimate refatorar o modulo de pagamentos');
  assert.equal(p.decision, 'block'); assert.match(p.reason, /Nada foi enviado ao modelo/); assert.match(p.reason, /ESTIMATIVA/);
  assert.doesNotMatch(p.reason, /precost approve/);
  assert.equal(submit(e, 'refatorar o modulo de pagamentos').decision, 'block'); // previa nao aprova
  assert.match(submit(e, 'precost last').reason, /BLOQUEADO/);
});

test('arquivo ignorado (segredo/grande): mudar o conteudo invalida a aprovacao por assinatura de stat, sem ler o conteudo', () => {
  const e = mkenv(CFG); const proj = join(e.dir, 'p2'); mkdirSync(proj);
  writeFileSync(join(proj, '.env'), 'A=1');
  const run = (prompt) => JSON.parse(spawnSync('node', [hook], { input: JSON.stringify({ session_id: 's1', prompt, cwd: proj }), env: { ...process.env, PRECOST_CONFIG: e.c, PRECOST_STATE: e.st }, encoding: 'utf8' }).stdout);
  run(`precost approve ${codeOf(run('veja @.env'))}`);
  writeFileSync(join(proj, '.env'), 'A=12345'); // tamanho muda
  assert.equal(run('veja @.env').decision, 'block');
  run(`precost approve ${codeOf(run('veja @.env'))}`);
  assert.equal(run('veja @.env').decision, undefined); // controle positivo
});
test('regressao: sem config/limite os comandos precost continuam interceptados e nada vai ao modelo', () => {
  const r = (prompt) => JSON.parse(spawnSync('node', [hook], { input: JSON.stringify({ session_id: 's', prompt }), env: { ...process.env, PRECOST_CONFIG: '/nao/existe', PRECOST_STATE: mkenv({}).st }, encoding: 'utf8' }).stdout);
  for (const c of ['precost estimate x', 'precost last', 'precost approve deadbeef', 'precost revoke all']) assert.equal(r(c).decision, 'block', c);
  assert.equal(r('prompt comum').decision, undefined);
});
test('regressao: precost last e escopado por sessao (nao mostra codigo de outra sessao)', () => {
  const e = mkenv(CFG);
  const code = codeOf(submit(e, 'tarefa A', 's1'));
  assert.match(submit(e, 'precost last', 's1').reason, new RegExp(code));
  const o = submit(e, 'precost last', 's2'); assert.doesNotMatch(o.reason, new RegExp(code)); assert.match(o.reason, /nesta sessao/);
});
