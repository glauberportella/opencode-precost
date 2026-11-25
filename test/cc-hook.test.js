import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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
  const e2 = mkenv({ ...CFG, limitUsd: 1000 });
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
  const e = mkenv({ ...CFG, ttlMin: 0 });
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
test('modelo ativo desconhecido: sem gate e DIZ isso', () => {
  const e = mkenv({ limitUsd: 0.01 });
  const o = submit(e, 'qualquer');
  assert.equal(o.decision, undefined); assert.match(o.systemMessage, /SEM GATE/);
});
test('rastreador: SessionStart.model e PostModelSwitch.to_model definem o modelo da sessao', () => {
  const e = mkenv({ limitUsd: 1000 });
  const run = (ev) => spawnSync('node', [tracker], { input: JSON.stringify(ev), env: { ...process.env, PRECOST_STATE: e.st } });
  run({ hook_event_name: 'SessionStart', session_id: 's1', model: 'gemini-4-hydrogen' });
  assert.match(submit(e, 'x', 's1').systemMessage, /modelo ativo: gemini-4-hydrogen/);
  run({ hook_event_name: 'PostModelSwitch', session_id: 's1', from_model: 'gemini-4-hydrogen', to_model: 'gemini-4-neon' });
  assert.match(submit(e, 'x', 's1').systemMessage, /modelo ativo: gemini-4-neon/);
});
test('stdin invalido nao quebra o Claude Code (exit 0, sem saida)', () => {
  const r = spawnSync('node', [hook], { input: 'nao-json', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});
