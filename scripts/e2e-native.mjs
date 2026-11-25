// E2E multiplataforma (Linux, macOS, Windows nativo), sem bash. Clientes REAIS (Claude Code 2.1.332, opencode-ai 1.19.6) contra servidores FALSOS locais: sem chamada paga, sem credencial real.
// Uso: node scripts/e2e-native.mjs [claude|opencode|all]
// Claude Code: bloqueio -> approve -> reenvio (1 chamada ao mock) -> uso unico -> falha fechada (hook que quebra nao deixa o prompt chegar ao modelo) + controle negativo (onFailure continue deixa passar).
// OpenCode: o plugin carrega via shim, bloqueia (0 mensagens), approve, reenvio chega ao provedor (1), uso unico (1).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const R = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const which = process.argv[2] || 'all';
let FAIL = 0;
const chk = (name, got, want) => { const ok = String(got) === String(want); console.log(`${ok ? 'ok  ' : 'FALHOU'} ${name}${ok ? '' : ` (esperado ${want}, obtido ${got})`}`); if (!ok) FAIL = 1; };
const q = (s) => (WIN ? `"${String(s).replace(/"/g, '\\"')}"` : `'${String(s).replace(/'/g, "'\\''")}'`);
// roda um comando via shell (npx e .cmd no Windows exigem shell), com timeout; devolve {out, code}
function sh(cmd, env, cwd, timeoutMs = 120000) {
  const r = spawnSync(cmd, { shell: true, env, cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(child) { try { if (WIN) spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true }); else process.kill(-child.pid, 'SIGKILL'); } catch {} }
function startMock(script, env) {
  const c = spawn(process.execPath, [join(R, 'scripts', script)], { env, stdio: 'ignore', detached: !WIN, windowsHide: true });
  return c;
}

async function claude() {
  console.log(`== Claude Code plugin (${process.platform})`);
  const W = mkdtempSync(join(tmpdir(), 'precost-e2e-claude-'));
  const home = join(W, 'home'), cfgDir = join(W, 'cfg'), proj = join(W, 'proj');
  [home, cfgDir, proj].forEach((d) => mkdirSync(d, { recursive: true }));
  writeFileSync(join(W, 'cfg.json'), JSON.stringify({ model: 'claude-opus-5.5', limitUsd: 5 }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), CLAUDE_CONFIG_DIR: cfgDir, MOCKDIR: W, ANTHROPIC_BASE_URL: 'http://127.0.0.1:4590', ANTHROPIC_API_KEY: 'sk-ant-fake', PRECOST_CONFIG: join(W, 'cfg.json'), PRECOST_STATE: join(W, 'state'), ANTHROPIC_MODEL: 'claude-sonnet-5.5' };
  const mock = startMock('mock-anthropic.mjs', env); await sleep(1500);
  const calls = () => { const f = join(W, 'mock-model-calls.log'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0; };
  const CC = process.env.CLAUDE_CMD || 'npx --yes @anthropic-ai/claude-code@2.1.332';
  const P = 'Refatorar o modulo inteiro de pagamentos e reescrever todos os testes';
  const run = (prompt, plugin, extra = '') => sh(`${CC} -p ${q(prompt)} --plugin-dir ${q(plugin)} ${extra}`, env, proj, 150000).out;
  try {
    const sid = randomUUID();
    let out = run(P, R, `--session-id ${sid}`);
    chk('1 bloqueia', out.includes('BLOCKED'), true); chk('1 modelo nao chamado', calls(), 0);
    const code = (out.match(/precost approve ([0-9a-f]{8})/) || [])[1];
    chk('1 codigo de aprovacao presente', !!code, true);
    out = run(`precost approve ${code}`, R, `--resume ${sid}`);
    chk('2 aprovado (nao chama modelo)', out.includes('approved for') && calls() === 0, true);
    out = run(P, R, `--resume ${sid}`);
    chk('3 reenvio chama o modelo 1x', calls(), 1); chk('3 resposta do modelo', out.includes('mock ok'), true);
    out = run(P, R, `--resume ${sid}`);
    chk('4 uso unico: bloqueia de novo', out.includes('BLOCKED'), true); chk('4 modelo nao chamado de novo', calls(), 1);
    // falha fechada: hook.json com script inexistente e onFailure block
    const variant = (name, command, args, onFailure) => {
      const D = join(W, 'plug-' + name); mkdirSync(join(D, 'hooks'), { recursive: true });
      for (const f of ['.claude-plugin', 'adapters', 'src', 'data']) cpSync(join(R, f), join(D, f), { recursive: true });
      cpSync(join(R, 'package.json'), join(D, 'package.json'));
      writeFileSync(join(D, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command, args, timeout: 20, onFailure }] }] } }));
      return D;
    };
    let before = calls(); run(P, variant('crash', 'node', [join(W, 'nao-existe.js')], 'block'), `--session-id ${randomUUID()}`);
    chk('5 falha fechada: script que quebra nao chega ao modelo', calls() - before, 0);
    before = calls(); run(P, variant('nonode', 'node-inexistente-xyz', [join(R, 'adapters', 'claude-code', 'userpromptsubmit.js')], 'block'), `--session-id ${randomUUID()}`);
    chk('6 falha fechada: node ausente nao chega ao modelo', calls() - before, 0);
    before = calls(); run('ola', variant('open', 'node', [join(W, 'nao-existe.js')], 'continue'), `--session-id ${randomUUID()}`);
    chk('7 controle negativo: onFailure continue deixa passar', calls() - before, 1);
  } finally { killTree(mock); }
}

async function opencode() {
  console.log(`== OpenCode 1.19.6 (${process.platform})`);
  const W = mkdtempSync(join(tmpdir(), 'precost-e2e-oc-'));
  const home = join(W, 'home'), P = join(W, 'p');
  mkdirSync(home, { recursive: true }); mkdirSync(join(P, '.opencode', 'plugins'), { recursive: true });
  spawnSync('git init -q', { shell: true, cwd: P });
  const adapter = pathToFileURL(join(R, 'adapters', 'opencode', 'index.js')).href;
  const gateLog = join(P, 'gate.log');
  writeFileSync(join(P, '.opencode', 'plugins', 'precost.js'),
`import { appendFileSync } from 'node:fs';
import { PrecostPlugin } from ${JSON.stringify(adapter)};
export const P = async (input) => PrecostPlugin(input, { limitUsd: 0.5, version: undefined, stateDir: ${JSON.stringify(join(P, 'state'))}, historyPath: ${JSON.stringify(join(P, 'hist.json'))}, log: (t) => appendFileSync(${JSON.stringify(gateLog)}, t + '\\n=====\\n') });
`);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share') };
  const OC = process.env.OPENCODE_CMD || 'npx --yes opencode-ai@1.19.6';
  const port = 4570 + Math.floor(Math.random() * 100), B = `http://127.0.0.1:${port}`;
  const srv = spawn(`${OC} serve --port ${port} --hostname 127.0.0.1`, { shell: true, cwd: P, env, stdio: 'ignore', detached: !WIN, windowsHide: true });
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(B + '/global/health')).ok; } catch {} if (!up) await sleep(1000); }
    chk('0 servidor OpenCode subiu', up, true); if (!up) return;
    const id = (await (await fetch(B + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'gate' }) })).json()).id;
    const send = async (text) => {
      try { await fetch(`${B}/session/${id}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: { providerID: 'google', modelID: 'gemini-4-neon' }, parts: [{ type: 'text', text }] }), signal: AbortSignal.timeout(30000) }); } catch {}
      await sleep(1000);
      return (await (await fetch(`${B}/session/${id}/message`)).json()).length;
    };
    const T = 'refactor the whole module';
    chk('1 bloqueado: 0 mensagens', await send(T), 0);
    const log = () => (existsSync(gateLog) ? readFileSync(gateLog, 'utf8') : '');
    const code = (log().match(/precost approve ([0-9a-f]{8})/) || [])[1];
    chk('1 texto de bloqueio e codigo no log do plugin (plugin carregado)', !!code, true);
    chk('2 reenvio sem aprovar: 0', await send(T), 0);
    chk('3 approve: 0', await send(`precost approve ${code}`), 0);
    chk('4 reenvio aprovado chega ao provedor: 1', await send(T), 1);
    chk('5 uso unico: continua 1 (bloqueado de novo)', await send(T), 1);
  } finally { killTree(srv); }
}

if (which === 'claude' || which === 'all') await claude();
if (which === 'opencode' || which === 'all') await opencode();
console.log(FAIL ? 'E2E NATIVO FALHOU' : `E2E NATIVO OK (${process.platform}, servidores falsos, sem gasto)`);
process.exit(FAIL);
