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
import { tr, setLang } from './i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rj = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export const levelLabel = (l) => tr(l, { WARN: 'AVISO', FAIL: 'FALHA' }[l] ?? l);
export function doctor({ project = process.cwd(), claudeSettings = [], env = process.env } = {}) {
  const out = []; const add = (level, msg) => out.push({ level, msg });
  const cfgPath = configPath(env);
  let cfg = {};
  setLang(env.PRECOST_LANG);
  if (!existsSync(cfgPath)) add('WARN', tr(`config missing (${cfgPath}): the hook only informs, it does NOT block (no limit).`, `config ausente (${cfgPath}): o hook so informa, NAO bloqueia (sem limite).`));
  else { const c = rj(cfgPath); if (!c) add('FAIL', tr(`config unreadable: ${cfgPath} (the hook blocks everything until fixed).`, `config ilegivel: ${cfgPath} (o hook bloqueia tudo ate corrigir).`)); else { cfg = c; setLang(c.lang); const bad = validateConfig(c); if (bad) add('FAIL', tr(`invalid config: ${bad}`, `config invalida: ${bad}`)); else add(c.limitUsd == null ? 'WARN' : 'OK', c.limitUsd == null ? tr('config without limitUsd: informational only, no gate.', 'config sem limitUsd: so informativo, sem gate.') : tr(`valid config (limitUsd US$${c.limitUsd}).`, `config valida (limitUsd US$${c.limitUsd}).`)); } }
  try { const p = loadPrices(cfg.prices); add('OK', tr(`price table loaded (${Object.keys(p.models).length} models; source: ${p._source.kind}, date ${tableDate(p)}).`, `tabela de precos carregada (${Object.keys(p.models).length} modelos; origem: ${p._source.kind}, data ${tableDate(p)}).`)); const ag = ageDays(p); if (ag !== null && ag > STALE_DAYS) add('WARN', tr(`price table is ${ag} days old: run \`precost update-prices\` (prices change; the estimate may be outdated).`, `tabela de precos com ${ag} dias: rode \`precost update-prices\` (precos mudam; estimativa pode estar defasada).`)); } catch (e) { add('FAIL', tr(`price table: ${e.message}`, `tabela de precos: ${e.message}`)); }

  // Claude Code: o hook precisa estar em algum settings que o Claude le, com onFailure block.
  const cc = [...claudeSettings, join(claudeConfigDir(env), 'settings.json'), join(project, '.claude', 'settings.json'), join(project, '.claude', 'settings.local.json')];
  let ccFound = false;
  for (const f of cc) {
    const s = rj(f); if (!s?.hooks) continue;
    const ups = (s.hooks.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).filter((h) => /userpromptsubmit\.js/.test(h.command ?? ''));
    if (!ups.length) continue; ccFound = true;
    for (const h of ups) {
      const script = /(\S*userpromptsubmit\.js)/.exec(h.command)[1];
      add(existsSync(script) ? 'OK' : 'FAIL', tr(`Claude Code: UserPromptSubmit in ${f} -> ${script}${existsSync(script) ? '' : ' (FILE DOES NOT EXIST: the hook fails)'}`, `Claude Code: UserPromptSubmit em ${f} -> ${script}${existsSync(script) ? '' : ' (ARQUIVO NAO EXISTE: o hook falha)'}`));
      add(h.onFailure === 'block' ? 'OK' : 'FAIL', h.onFailure === 'block' ? tr('Claude Code: onFailure=block (crash/timeout/missing node do not let prompts through).', 'Claude Code: onFailure=block (crash/timeout/node ausente nao deixam passar).') : tr(`Claude Code: onFailure=${h.onFailure ?? 'missing'}: a crash, timeout or missing node lets the prompt reach the model (FAIL OPEN). Use "onFailure":"block".`, `Claude Code: onFailure=${h.onFailure ?? 'ausente'}: crash, timeout ou node ausente deixam o prompt chegar ao modelo (FALHA ABERTA). Use "onFailure":"block".`));
    }
    const trk = ['SessionStart', 'PostModelSwitch'].filter((e) => (s.hooks[e] ?? []).flatMap((g) => g.hooks ?? []).some((h) => /track-model\.js/.test(h.command ?? '')));
    const miss = ['SessionStart', 'PostModelSwitch'].filter((e) => !trk.includes(e)).join(', ');
    add(trk.length === 2 ? 'OK' : 'WARN', trk.length === 2 ? tr('Claude Code: SessionStart and PostModelSwitch trackers present.', 'Claude Code: rastreadores SessionStart e PostModelSwitch presentes.') : tr(`Claude Code: tracker missing for ${miss}: without it the model only comes from observed/declared sources (worst case unless trustConfiguredModel).`, `Claude Code: rastreador ausente em ${miss}: sem ele o modelo so vem de fontes observadas/declaradas (pior caso salvo trustConfiguredModel).`));
  }
  if (!ccFound) add('INFO', tr('Claude Code: precost UserPromptSubmit hook not found in the checked settings (fine if you do not use Claude Code, or pass --claude-settings PATH).', 'Claude Code: hook UserPromptSubmit do precost nao encontrado nos settings verificados (ok se voce nao usa Claude Code, ou passe --claude-settings CAMINHO).'));

  // OpenCode: plugin local do projeto ou global.
  const ocDirs = [join(project, '.opencode', 'plugins'), join(opencodeConfigDir(env), 'plugins')]; let ocFound = false;
  for (const d of ocDirs) { try { for (const f of readdirSync(d)) { const t = readFileSync(join(d, f), 'utf8'); if (/adapters[\\/]opencode[\\/]index\.js/.test(t)) { ocFound = true; const m = /from\s+['"]([^'"]*adapters[\\/]opencode[\\/]index\.js)['"]/.exec(t); add(m && existsSync(m[1]) ? 'OK' : 'FAIL', tr(`OpenCode: plugin in ${join(d, f)}${m && existsSync(m[1]) ? '' : ' (import points to a missing file: the plugin does not load)'}`, `OpenCode: plugin em ${join(d, f)}${m && existsSync(m[1]) ? '' : ' (import aponta para arquivo inexistente: o plugin nao carrega)'}`)); } } } catch { /* sem pasta */ } }
  if (!ocFound) add('INFO', tr('OpenCode: precost plugin not found in .opencode/plugins (project) or the global directory (fine if you do not use OpenCode).', 'OpenCode: plugin do precost nao encontrado em .opencode/plugins (projeto) nem no diretorio global (ok se voce nao usa OpenCode).'));

  // Execucao real do hook neste node, com prompt grande e limite minimo, em estado temporario: deve BLOQUEAR sem chamar nada.
  const tmp = mkdtempSync(join(tmpdir(), 'precost-doctor-')); writeFileSync(join(tmp, 'c.json'), JSON.stringify({ model: 'claude-sonnet-5.5', limitUsd: 0.01 }));
  const r = spawnSync(process.execPath, [join(ROOT, 'adapters/claude-code/userpromptsubmit.js')], { input: JSON.stringify({ session_id: 'doctor', prompt: 'x'.repeat(4000), cwd: tmp }), env: { ...env, PRECOST_CONFIG: join(tmp, 'c.json'), PRECOST_STATE: join(tmp, 'st') }, encoding: 'utf8', timeout: 20000 });
  let blocked = false; try { blocked = JSON.parse(r.stdout).decision === 'block'; } catch { /* nao JSON */ }
  add(blocked ? 'OK' : 'FAIL', blocked ? tr(`hook runs on ${process.execPath} (node ${process.version}) and blocks a large prompt under a minimal limit (temporary state, no model call).`, `hook executa em ${process.execPath} (node ${process.version}) e bloqueia prompt grande com limite minimo (estado temporario, nenhuma chamada a modelo).`) : tr(`hook did NOT block in the local test (output: ${String(r.stdout || r.stderr).slice(0, 120)}).`, `hook NAO bloqueou no teste local (saida: ${String(r.stdout || r.stderr).slice(0, 120)}).`));
  add('WARN', tr('LIMIT: the doctor proves files, config and local execution; it does NOT prove that the client loaded the hook/plugin IN THIS session. Fail closed only holds while the hook/plugin is loaded. If it is not loaded, large prompts pass with no preview and no gate. Load test without a paid provider: `npm run e2e:claude` / `e2e:opencode` (local fake server). In a real session, type `precost last` first: with the hook loaded the answer comes from precost without a model; if the model answers, the hook is NOT loaded (cost of one short prompt).', 'LIMITE: o doctor prova arquivos, config e execucao local; NAO prova que o cliente carregou o hook/plugin NESTA sessao. Fail-closed so vale com hook/plugin carregado. Se o plugin/hook nao carregar, prompts grandes passam sem previa nem gate. Teste de carga sem provedor pago: `npm run e2e:claude` / `e2e:opencode` (servidor falso local). Em sessao real, digite `precost last` primeiro: com o hook carregado a resposta vem do precost sem modelo; se o modelo responder, o hook NAO esta carregado (custo de um prompt curto).'));
  return out;
}
