import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.PRECOST_LANG = 'pt'; // this suite asserts the Portuguese text; English is covered in i18n.test.js

const cli = fileURLToPath(new URL('../bin/precost.js', import.meta.url));
const sess = (n) => Array.from({ length: 5 }, () => ({ input: n, output: 100, cache_read: 0, turns: 5, peakCtx: 50_000 }));
const run = (args, hist) => { const d = mkdtempSync(join(tmpdir(), 'cli-')); const f = join(d, 'h.json'); writeFileSync(f, JSON.stringify(hist)); return spawnSync('node', [cli, '--task', 'x', ...args, '--history', f], { encoding: 'utf8' }); };
test('CLI compare: historico como lista com varios modelos e recusado; mapa usa cada linha so com o seu', () => {
  const lista = run(['--model', 'gemini-3.7-flash', '--model', 'gemini-3.8-flash'], sess(10_000));
  assert.equal(lista.status, 2); assert.match(lista.stderr, /mapa/);
  const mapa = run(['--model', 'gemini-3.7-flash', '--model', 'gemini-3.8-flash'], { 'gemini-3.7-flash': sess(10_000), 'gemini-3.8-flash': sess(2_000_000) });
  assert.equal(mapa.status, 0);
  const usd = (m) => Number(new RegExp(`- ${m.replace('.', '\\.')}[^\\n]*?tarefa US\\$([0-9.]+)`).exec(mapa.stdout)[1]);
  assert.ok(usd('gemini-3.8-flash') > 20 * usd('gemini-3.7-flash'));
  assert.equal(run(['--model', 'gemini-3.7-flash'], sess(10_000)).status, 0); // um modelo com lista: ok
});
