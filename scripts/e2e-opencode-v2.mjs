// E2E OpenCode V2 (opencode 2.x, @opencode/cli) contra servidor FALSO local: sem chamada paga, sem credencial real.
// Uso: node scripts/e2e-opencode-v2.mjs   (OPENCODE_V2_CMD sobrescreve o comando; padrao: npx --yes @opencode/cli@2.4.2)
// Verifica: plugin V2 carrega, bloqueio (0 chamadas ao mock), approve, reenvio chega ao provedor, uso unico, falha fechada em versao nao verificada.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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
writeFileSync(join(P, 'opencode.jsonc'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'mock/claude-sonnet-5.5', providers: { mock: { name: 'Mock', env: ['MOCK_API_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${port}/v1` }, models: { 'claude-sonnet-5.5': { name: 'Sonnet' }, 'claude-opus-5': { name: 'Opus' } } } } }));
let adapterPath = join(R, 'adapters', 'opencode-v2', 'index.js');
if (process.env.E2E_PACKED === '1') { // tarball limpo: npm pack -> instala num projeto vazio -> usa o adapter instalado
  const inst = join(W, 'inst'); mkdirSync(inst, { recursive: true });
  const pk = spawnSync('npm pack --silent --pack-destination ' + q(inst), { shell: true, cwd: R, encoding: 'utf8' });
  const tgz = join(inst, (pk.stdout || '').trim().split('\n').pop());
  writeFileSync(join(inst, 'package.json'), '{"name":"inst","private":true}');
  const ins = spawnSync('npm install --no-audit --no-fund ' + q(tgz), { shell: true, cwd: inst, encoding: 'utf8' });
  if (ins.status !== 0) { console.log('FALHOU npm install do tarball', ins.stderr); process.exit(1); }
  adapterPath = join(inst, 'node_modules', 'opencode-precost', 'adapters', 'opencode-v2', 'index.js');
  console.log('usando o adapter do tarball instalado:', adapterPath);
}
const adapter = pathToFileURL(adapterPath).href;
const writePlugin = (extra, limit = 0.5) => writeFileSync(join(P, '.opencode', 'plugins', 'precost.js'),
`import { appendFileSync } from 'node:fs';
import { precostV2 } from ${JSON.stringify(adapter)};
export default precostV2({ limitUsd: ${limit}, stateDir: ${JSON.stringify(state)}, log: (t) => appendFileSync(${JSON.stringify(gateLog)}, t + '\\n=====\\n')${extra} });
`);
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'), XDG_CACHE_HOME: join(home, '.cache'), MOCK_API_KEY: 'x', MOCKLOG: mockLog, MOCKPORT: String(port) };
const mock = spawn(process.execPath, [join(R, 'scripts', 'mock-openai.mjs')], { env, stdio: 'ignore', detached: !WIN, windowsHide: true });
const calls = () => (existsSync(mockLog) ? readFileSync(mockLog, 'utf8').split('\n').filter((l) => l.includes('/chat/completions')).length : 0);
const bigCalls = () => (existsSync(mockLog) ? readFileSync(mockLog, 'utf8').split('\n').filter((l) => l.includes('/chat/completions') && Number(l.split(' ')[2]) > 10000).length : 0); // pedido principal do agente (o de titulo e pequeno e nao e coberto pelo gate)
const run = (session, text, extra = '') => spawnSync(`${OC} --standalone run -s ${session} ${extra} ${q(text)}`, { shell: true, env, cwd: P, encoding: 'utf8', timeout: 120000, windowsHide: true });
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
  const text = readFileSync(adapterPath, 'utf8');
  // falha fechada: versao fora da lista verificada bloqueia ate prompt barato; controle negativo com a versao certa passa
  writePlugin(", verifiedVersions: ['0.0.0']", 1000);
  const S2 = 'ses_precoste2f' + Date.now().toString(36);
  b = calls(); run(S2, 'hi'); chk('6 versao nao verificada: prompt barato bloqueado (falha fechada): 0', calls() - b, 0);
  writePlugin('', 1000);
  b = calls(); run(S2, 'hi'); chk('7 controle: versao verificada deixa o prompt barato passar (>=1)', calls() - b >= 1, true);
  // arquivos anexados: contado quando pequeno e legivel; nao contado (grande) bloqueia com aviso mesmo com limite alto
  writePlugin('', 1000);
  const S3 = 'ses_precoste2g' + Date.now().toString(36);
  writeFileSync(join(P, 'small.txt'), 'hello');
  writeFileSync(join(P, 'pic.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  b = calls(); run(S3, 'read this', '-f small.txt'); chk('9 anexo pequeno contado: passa (>=1)', calls() - b >= 1, true);
  b = calls(); run(S3, 'read the image', '-f pic.png'); chk('10 anexo binario/imagem nao contado: bloqueado (0)', calls() - b, 0);
  chk('10 aviso de arquivo nao contado no log', /NOT counted|larger than/.test(log()), true);
  // modelo: sessao em outro modelo do mesmo provedor passa pelo gate no modelo certo
  const S4 = 'ses_precoste2h' + Date.now().toString(36);
  b = calls(); run(S4, 'hi', '-m mock/claude-opus-5');
  chk('11 modelo da sessao (opus) e o usado pelo gate: estimou em opus (sem preco: bloqueado, 0)', calls() - b === 0 && /active model: claude-opus-5/.test(log()), true);
  // modelo efetivo diferente do estimado (simula agente/plugin que troca o modelo na resolucao): o hook de contexto bloqueia
  writePlugin('', 1000);
  writeFileSync(join(P, '.opencode', 'plugins', 'switch.js'), `export default { id: 'switch-model', async setup(ctx) { await ctx.session.hook('experimental.model.resolve', async (e) => { e.model = { ...e.model, id: 'claude-opus-5' }; }); } };\n`);
  const S6 = 'ses_precoste2j' + Date.now().toString(36);
  b = bigCalls(); run(S6, 'hi'); chk('13 modelo efetivo diferente do estimado: pedido principal bloqueado antes do provedor (0)', bigCalls() - b, 0);
  chk('13 aviso de modelo diferente no motivo', /not the one the estimate was made for/.test(existsSync(join(state, 'last-block-v2.txt')) ? readFileSync(join(state, 'last-block-v2.txt'), 'utf8') : ''), true);
  rmSync(join(P, '.opencode', 'plugins', 'switch.js'));
  // sessionLimitUsd configurado: nao pode ser ignorado em silencio
  writePlugin(', sessionLimitUsd: 5', 1000);
  const S5 = 'ses_precoste2i' + Date.now().toString(36);
  b = calls(); run(S5, 'hi'); chk('12 sessionLimitUsd configurado: bloqueia (falha fechada), nao ignora: 0', calls() - b, 0);
  chk('12 motivo menciona sessionLimitUsd', /sessionLimitUsd/.test(readFileSync(join(state, 'last-block-v2.txt'), 'utf8')), true);
  chk('8 lista de versoes verificadas declarada', /VERIFIED_OPENCODE_V2 = \['2\.4\.2'\]/.test(text), true);
} finally { killTree(mock); }
console.log(FAIL ? 'E2E OPENCODE V2 FALHOU' : `E2E OPENCODE V2 OK (${process.platform}, servidor falso, sem gasto)`);
process.exit(FAIL);
