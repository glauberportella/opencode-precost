// E2E OpenCode V2 (opencode 2.x, @opencode/cli) contra servidor FALSO local: sem chamada paga, sem credencial real.
// Uso: node scripts/e2e-opencode-v2.mjs   (OPENCODE_V2_CMD sobrescreve o comando; padrao: npx --yes @opencode/cli@2.4.2)
// Verifica: plugin V2 carrega, bloqueio (0 chamadas ao mock), approve, reenvio chega ao provedor, uso unico, falha fechada em versao nao verificada.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const R = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
let FAIL = 0;
const chk = (name, got, want) => { const ok = String(got) === String(want); console.log(`${ok ? 'ok  ' : 'FALHOU'} ${name}${ok ? '' : ` (esperado ${want}, obtido ${got})`}`); if (!ok) FAIL = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(child) { try { if (WIN) spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true }); else process.kill(-child.pid, 'SIGKILL'); } catch {} }
const q = (s) => (WIN ? `"${String(s).replace(/"/g, '\\"')}"` : `'${String(s).replace(/'/g, "'\\''")}'`);

const OC = process.env.OPENCODE_V2_CMD || 'npx --yes -p @opencode/cli@2.4.2 opencode2';
const W = mkdtempSync(join(tmpdir(), 'precost-e2e-oc2-'));
const home = join(W, 'home'), P = join(W, 'p'), state = join(P, 'state'), gateLog = join(P, 'gate.log'), mockLog = join(W, 'mock.log');
mkdirSync(home, { recursive: true }); mkdirSync(join(P, '.opencode', 'plugins'), { recursive: true });
spawnSync('git init -q', { shell: true, cwd: P });
const port = 4700 + Math.floor(Math.random() * 200);
writeFileSync(join(P, 'opencode.jsonc'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'mock/claude-sonnet-5.5', providers: { mock: { name: 'Mock', env: ['MOCK_API_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${port}/v1` }, models: { 'claude-sonnet-5.5': { name: 'Sonnet' } } } } }));
const adapter = pathToFileURL(join(R, 'adapters', 'opencode-v2', 'index.js')).href;
const writePlugin = (extra, limit = 0.5) => writeFileSync(join(P, '.opencode', 'plugins', 'precost.js'),
`import { appendFileSync } from 'node:fs';
import { precostV2 } from ${JSON.stringify(adapter)};
export default precostV2({ limitUsd: ${limit}, stateDir: ${JSON.stringify(state)}, log: (t) => appendFileSync(${JSON.stringify(gateLog)}, t + '\\n=====\\n')${extra} });
`);
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_CACHE_HOME: join(home, '.cache'), MOCK_API_KEY: 'x', MOCKLOG: mockLog, MOCKPORT: String(port) };
const mock = spawn(process.execPath, [join(R, 'scripts', 'mock-openai.mjs')], { env, stdio: 'ignore', detached: !WIN, windowsHide: true });
const calls = () => (existsSync(mockLog) ? readFileSync(mockLog, 'utf8').split('\n').filter((l) => l.includes('/chat/completions')).length : 0);
const run = (session, text) => spawnSync(`${OC} --standalone run -s ${session} ${q(text)}`, { shell: true, env, cwd: P, encoding: 'utf8', timeout: 120000, windowsHide: true });
const log = () => (existsSync(gateLog) ? readFileSync(gateLog, 'utf8') : '');
try {
  await sleep(1000);
  writePlugin('');
  const S = 'ses_precoste2e' + Date.now().toString(36);
  const T = 'refactor the whole module and rewrite every test';
  let b = calls(); run(S, T);
  chk('1 bloqueado: 0 chamadas ao provedor', calls() - b, 0);
  const code = (log().match(/precost approve ([0-9a-f]{8})/) || [])[1];
  chk('1 texto de bloqueio e codigo no log do plugin (plugin V2 carregou)', !!code, true);
  const last = spawnSync(process.execPath, [join(R, 'bin', 'precost.js'), 'last'], { env: { ...env, PRECOST_STATE: state }, encoding: 'utf8' });
  chk("1 'precost last' no terminal mostra o motivo do bloqueio", /BLOCKED: estimated high range/.test(last.stdout || ''), true);
  b = calls(); run(S, T); chk('2 reenvio sem aprovar: 0', calls() - b, 0);
  b = calls(); run(S, `precost approve ${code}`); chk('3 approve nao chega ao provedor: 0', calls() - b, 0);
  b = calls(); run(S, T); chk('4 reenvio aprovado chega ao provedor (>=1)', calls() - b >= 1, true);
  b = calls(); run(S, T); chk('5 uso unico: bloqueado de novo: 0', calls() - b, 0);
  // falha fechada: versao fora da lista verificada
  const text = readFileSync(join(R, 'adapters', 'opencode-v2', 'index.js'), 'utf8');
  // falha fechada: versao fora da lista verificada bloqueia ate prompt barato; controle negativo com a versao certa passa
  writePlugin(", verifiedVersions: ['0.0.0']", 1000);
  const S2 = 'ses_precoste2f' + Date.now().toString(36);
  b = calls(); run(S2, 'hi'); chk('6 versao nao verificada: prompt barato bloqueado (falha fechada): 0', calls() - b, 0);
  writePlugin('', 1000);
  b = calls(); run(S2, 'hi'); chk('7 controle: versao verificada deixa o prompt barato passar (>=1)', calls() - b >= 1, true);
  chk('8 lista de versoes verificadas declarada', /VERIFIED_OPENCODE_V2 = \['2\.4\.2'\]/.test(text), true);
} finally { killTree(mock); }
console.log(FAIL ? 'E2E OPENCODE V2 FALHOU' : `E2E OPENCODE V2 OK (${process.platform}, servidor falso, sem gasto)`);
process.exit(FAIL);
