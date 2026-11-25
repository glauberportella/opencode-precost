import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = new URL('../adapters/claude-code/userpromptsubmit.js', import.meta.url).pathname;
function run(prompt, cfg, state) {
  const dir = mkdtempSync(join(tmpdir(), 'pc-'));
  const cfgPath = join(dir, 'c.json'); writeFileSync(cfgPath, JSON.stringify(cfg));
  return spawnSync('node', [hook], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt }), env: { ...process.env, PRECOST_CONFIG: cfgPath, PRECOST_STATE: state ?? join(dir, 'st') }, encoding: 'utf8' });
}
test('abaixo do limite: informa, nao bloqueia', () => {
  const r = run('corrigir typo', { model: 'gemini-4-hydrogen', limitUsd: 100 });
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.ok(o.systemMessage.includes('gemini-4-hydrogen')); assert.equal(o.decision, undefined);
});
test('acima do limite: bloqueia; reenviar o mesmo prompt aprova', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-')); const st = join(dir, 'st');
  const cfg = { model: 'gemini-4-neon', limitUsd: 0.5 };
  const a = JSON.parse(run('refatorar modulo inteiro', cfg, st).stdout);
  assert.equal(a.decision, 'block'); assert.match(a.reason, /Reenvie o MESMO prompt/);
  const b = JSON.parse(run('refatorar modulo inteiro', cfg, st).stdout);
  assert.equal(b.decision, undefined); assert.match(b.systemMessage, /aprovado/);
  const c = JSON.parse(run('outro prompt diferente', cfg, st).stdout);
  assert.equal(c.decision, 'block');
});
test('stdin invalido nao quebra o Claude Code (exit 0, sem saida)', () => {
  const r = spawnSync('node', [hook], { input: 'nao-json', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});
