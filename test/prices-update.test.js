import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePrices, diffPrices, tableDate, fetchSource } from '../src/prices-update.js';
import { stateDir, configPath, ledgerPath, userPricesPath, safeId } from '../src/paths.js';
process.env.PRECOST_LANG = 'pt'; // this suite asserts the Portuguese text; English is covered in i18n.test.js

const root = fileURLToPath(new URL('..', import.meta.url));
const bundled = JSON.parse(readFileSync(join(root, 'data/prices.json'), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(bundled));
const cli = (args, env) => spawnSync(process.execPath, [join(root, 'bin/precost.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const sandbox = () => { const d = mkdtempSync(join(tmpdir(), 'precost-pu-')); return { d, env: { PRECOST_CONFIG: join(d, 'cfg', 'config.json'), PRECOST_STATE: join(d, 'st') } }; };

test('tabela embutida e valida e tem data', () => { assert.equal(validatePrices(bundled), null); assert.match(tableDate(bundled), /^\d{4}-\d{2}-\d{2}$/); });
test('validacao recusa preco negativo, sem fonte https e moeda errada', () => {
  const a = clone(); a.models[Object.keys(a.models)[0]].input = -1; assert.match(validatePrices(a), /input/);
  const b = clone(); b.models[Object.keys(b.models)[0]].source = 'http://x'; assert.match(validatePrices(b), /source/);
  const c = clone(); c.currency = 'BRL'; assert.match(validatePrices(c), /USD/);
  assert.match(validatePrices({ currency: 'USD', models: {} }), /vazio/);
});
test('diff aponta preco alterado, modelo novo/removido e variacao > 5x', () => {
  const n = clone(); const [k1, k2] = Object.keys(n.models); n.models[k1].input *= 10; delete n.models[k2]; n.models['novo-1'] = { input: 1, output: 2, source: 'https://x', read: '2026-12-01' };
  const d = diffPrices(bundled, n);
  assert.equal(d.big.length, 1); assert.equal(d.removed, 1); assert.ok(d.changes.some((c) => c.kind === 'novo'));
});
test('fonte remota exige https (loopback liberado so para teste) e arquivo local funciona', async () => {
  await assert.rejects(fetchSource('http://example.com/p.json'), /https/);
  const d = mkdtempSync(join(tmpdir(), 'precost-pu-')); const f = join(d, 'p.json'); writeFileSync(f, JSON.stringify(bundled));
  assert.equal((await fetchSource(f)).table.currency, 'USD');
  await assert.rejects(fetchSource(join(d, 'nao-json.txt')), /ENOENT/);
});
test('update-prices: sem --yes nada e gravado; com --yes grava; tabela mais nova passa a valer; mais antiga e recusada', () => {
  const { d, env } = sandbox();
  const n = clone(); const k = Object.keys(n.models)[0]; n.models[k].input = n.models[k].input * 2; for (const m of Object.values(n.models)) m.read = '2099-01-01';
  const f = join(d, 'new.json'); writeFileSync(f, JSON.stringify(n));
  let r = cli(['update-prices', '--from', f], env); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /nada gravado/); assert.equal(existsSync(userPricesPath(env)), false);
  r = cli(['update-prices', '--from', f, '--yes'], env); assert.equal(r.status, 0, r.stderr); assert.equal(existsSync(userPricesPath(env)), true);
  r = cli(['prices'], env); assert.match(r.stdout, /tabela em uso: user/); assert.match(r.stdout, /2099-01-01/);
  const old = clone(); for (const m of Object.values(old.models)) m.read = '2020-01-01'; const fo = join(d, 'old.json'); writeFileSync(fo, JSON.stringify(old));
  r = cli(['update-prices', '--from', fo, '--yes'], env); assert.equal(r.status, 1); assert.match(r.stderr, /mais antiga/);
  r = cli(['update-prices', '--reset'], env); assert.match(r.stdout, /removida/); assert.match(cli(['prices'], env).stdout, /bundled/);
});
test('update-prices recusa tabela invalida, remocao/variacao suspeita sem --force e mantem a atual', () => {
  const { d, env } = sandbox();
  const bad = clone(); bad.models[Object.keys(bad.models)[0]].output = 'x'; const fb = join(d, 'bad.json'); writeFileSync(fb, JSON.stringify(bad));
  let r = cli(['update-prices', '--from', fb, '--yes'], env); assert.equal(r.status, 1); assert.match(r.stderr, /recusada/); assert.equal(existsSync(userPricesPath(env)), false);
  const sus = clone(); for (const m of Object.values(sus.models)) m.read = '2099-01-01'; delete sus.models[Object.keys(sus.models)[0]]; const fs_ = join(d, 'sus.json'); writeFileSync(fs_, JSON.stringify(sus));
  r = cli(['update-prices', '--from', fs_, '--yes'], env); assert.equal(r.status, 1); assert.match(r.stderr, /suspeitas/); assert.equal(existsSync(userPricesPath(env)), false);
  r = cli(['update-prices', '--from', fs_, '--yes', '--force'], env); assert.equal(r.status, 0, r.stderr); assert.equal(existsSync(userPricesPath(env)), true);
});
test('update-prices baixa de servidor local e falha de rede mantem a tabela', async () => {
  const { env } = sandbox(); const n = clone(); for (const m of Object.values(n.models)) m.read = '2099-01-01';
  const srv = createServer((q, s) => { s.end(JSON.stringify(n)); }); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/p.json`;
  const { spawn } = await import('node:child_process');
  const go = (args) => new Promise((res) => { const p = spawn(process.execPath, [join(root, 'bin/precost.js'), ...args], { env: { ...process.env, ...env } }); let o = '', e = ''; p.stdout.on('data', (x) => (o += x)); p.stderr.on('data', (x) => (e += x)); p.on('close', (code) => res({ code, o, e })); });
  const ok = await go(['update-prices', '--from', url, '--yes']); assert.equal(ok.code, 0, ok.e); assert.match(ok.o, /gravado em/);
  srv.close(); const down = await go(['update-prices', '--from', url, '--yes']); assert.equal(down.code, 1); assert.match(down.e, /Tabela atual mantida/);
});
test('caminhos por plataforma: Windows usa APPDATA/LOCALAPPDATA; Linux/macOS mantem os da v0.2.0; env manda', () => {
  const w = { APPDATA: 'C:\\U\\AppData\\Roaming', LOCALAPPDATA: 'C:\\U\\AppData\\Local' };
  assert.match(configPath(w, 'win32'), /Roaming.*precost.*config\.json$/); assert.match(stateDir(w, 'win32'), /Local.*precost.*state$/); assert.match(ledgerPath(w, 'win32'), /Local.*precost.*sessions\.json$/);
  assert.match(configPath({}, 'linux'), /\.config.precost.config\.json$/); assert.match(stateDir({}, 'darwin'), /\.cache.precost$/);
  assert.equal(stateDir({ PRECOST_STATE: 'X' }, 'win32'), 'X'); assert.match(userPricesPath({}, 'linux'), /precost.prices\.json$/);
  assert.equal(safeId('a:b/c*d'), 'a_b_c_d');
});
test('update-prices sem fonte falha com orientacao e nao altera nada', () => {
  const { env } = sandbox();
  const r = cli(['update-prices'], { ...env, PRECOST_PRICES_SOURCE: '' });
  assert.equal(r.status, 1); assert.match(r.stderr, /informe a fonte/); assert.equal(existsSync(userPricesPath(env)), false);
});
