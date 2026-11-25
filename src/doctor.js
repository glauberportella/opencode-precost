// precost doctor: verificacao LOCAL e SEM chamada ao modelo/provedor. Prova arquivos, config, execucao do hook neste node.
// NAO prova que o cliente (Claude Code/OpenCode) carregou o hook/plugin na sessao: o fail-closed so vale com hook/plugin carregado.
import { readFileSync, existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { configPath, claudeConfigDir, opencodeConfigDir, userPricesPath } from './paths.js';
import { ageDays, tableDate, STALE_DAYS } from './prices-update.js';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './gate.js';
import { loadPrices } from './pricing.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rj = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function doctor({ project = process.cwd(), claudeSettings = [], env = process.env } = {}) {
  const out = []; const add = (level, msg) => out.push({ level, msg });
  const cfgPath = configPath(env);
  let cfg = {};
  if (!existsSync(cfgPath)) add('AVISO', `config ausente (${cfgPath}): o hook so informa, NAO bloqueia (sem limite).`);
  else { const c = rj(cfgPath); if (!c) add('FALHA', `config ilegivel: ${cfgPath} (o hook bloqueia tudo ate corrigir).`); else { cfg = c; const bad = validateConfig(c); if (bad) add('FALHA', `config invalida: ${bad}`); else add(c.limitUsd == null ? 'AVISO' : 'OK', c.limitUsd == null ? 'config sem limitUsd: so informativo, sem gate.' : `config valida (limitUsd US$${c.limitUsd}).`); } }
  try { const p = loadPrices(cfg.prices); add('OK', `tabela de precos carregada (${Object.keys(p.models).length} modelos; origem: ${p._source.kind}, data ${tableDate(p)}).`); const ag = ageDays(p); if (ag !== null && ag > STALE_DAYS) add('AVISO', `tabela de precos com ${ag} dias: rode \`precost update-prices\` (precos mudam; estimativa pode estar defasada).`); } catch (e) { add('FALHA', `tabela de precos: ${e.message}`); }

  // Claude Code: o hook precisa estar em algum settings que o Claude le, com onFailure block.
  const cc = [...claudeSettings, join(claudeConfigDir(env), 'settings.json'), join(project, '.claude', 'settings.json'), join(project, '.claude', 'settings.local.json')];
  let ccFound = false;
  for (const f of cc) {
    const s = rj(f); if (!s?.hooks) continue;
    const ups = (s.hooks.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).filter((h) => /userpromptsubmit\.js/.test(h.command ?? ''));
    if (!ups.length) continue; ccFound = true;
    for (const h of ups) {
      const script = /(\S*userpromptsubmit\.js)/.exec(h.command)[1];
      add(existsSync(script) ? 'OK' : 'FALHA', `Claude Code: UserPromptSubmit em ${f} -> ${script}${existsSync(script) ? '' : ' (ARQUIVO NAO EXISTE: o hook falha)'}`);
      add(h.onFailure === 'block' ? 'OK' : 'FALHA', h.onFailure === 'block' ? 'Claude Code: onFailure=block (crash/timeout/node ausente nao deixam passar).' : `Claude Code: onFailure=${h.onFailure ?? 'ausente'}: crash, timeout ou node ausente deixam o prompt chegar ao modelo (FALHA ABERTA). Use "onFailure":"block".`);
    }
    const trk = ['SessionStart', 'PostModelSwitch'].filter((e) => (s.hooks[e] ?? []).flatMap((g) => g.hooks ?? []).some((h) => /track-model\.js/.test(h.command ?? '')));
    add(trk.length === 2 ? 'OK' : 'AVISO', trk.length === 2 ? 'Claude Code: rastreadores SessionStart e PostModelSwitch presentes.' : `Claude Code: rastreador ausente em ${['SessionStart', 'PostModelSwitch'].filter((e) => !trk.includes(e)).join(', ')}: sem ele o modelo so vem de fontes observadas/declaradas (pior caso salvo trustConfiguredModel).`);
  }
  if (!ccFound) add('INFO', 'Claude Code: hook UserPromptSubmit do precost nao encontrado nos settings verificados (ok se voce nao usa Claude Code, ou passe --claude-settings CAMINHO).');

  // OpenCode: plugin local do projeto ou global.
  const ocDirs = [join(project, '.opencode', 'plugins'), join(opencodeConfigDir(env), 'plugins')]; let ocFound = false;
  for (const d of ocDirs) { try { for (const f of readdirSync(d)) { const t = readFileSync(join(d, f), 'utf8'); if (/adapters[\\/]opencode[\\/]index\.js/.test(t)) { ocFound = true; const m = /from\s+['"]([^'"]*adapters[\\/]opencode[\\/]index\.js)['"]/.exec(t); add(m && existsSync(m[1]) ? 'OK' : 'FALHA', `OpenCode: plugin em ${join(d, f)}${m && existsSync(m[1]) ? '' : ' (import aponta para arquivo inexistente: o plugin nao carrega)'}`); } } } catch { /* sem pasta */ } }
  if (!ocFound) add('INFO', 'OpenCode: plugin do precost nao encontrado em .opencode/plugins (projeto) nem no diretorio global (ok se voce nao usa OpenCode).');

  // Execucao real do hook neste node, com prompt grande e limite minimo, em estado temporario: deve BLOQUEAR sem chamar nada.
  const tmp = mkdtempSync(join(tmpdir(), 'precost-doctor-')); writeFileSync(join(tmp, 'c.json'), JSON.stringify({ model: 'claude-sonnet-5.5', limitUsd: 0.01 }));
  const r = spawnSync(process.execPath, [join(ROOT, 'adapters/claude-code/userpromptsubmit.js')], { input: JSON.stringify({ session_id: 'doctor', prompt: 'x'.repeat(4000), cwd: tmp }), env: { ...env, PRECOST_CONFIG: join(tmp, 'c.json'), PRECOST_STATE: join(tmp, 'st') }, encoding: 'utf8', timeout: 20000 });
  let blocked = false; try { blocked = JSON.parse(r.stdout).decision === 'block'; } catch { /* nao JSON */ }
  add(blocked ? 'OK' : 'FALHA', blocked ? `hook executa em ${process.execPath} (node ${process.version}) e bloqueia prompt grande com limite minimo (estado temporario, nenhuma chamada a modelo).` : `hook NAO bloqueou no teste local (saida: ${String(r.stdout || r.stderr).slice(0, 120)}).`);
  add('AVISO', 'LIMITE: o doctor prova arquivos, config e execucao local; NAO prova que o cliente carregou o hook/plugin NESTA sessao. Fail-closed so vale com hook/plugin carregado. Se o plugin/hook nao carregar, prompts grandes passam sem previa nem gate. Teste de carga sem provedor pago: `npm run e2e:claude` / `e2e:opencode` (servidor falso local). Em sessao real, digite `precost last` primeiro: com o hook carregado a resposta vem do precost sem modelo; se o modelo responder, o hook NAO esta carregado (custo de um prompt curto).');
  return out;
}
