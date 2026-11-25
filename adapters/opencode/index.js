// Plugin OpenCode (API V1, pacote @opencode-ai/plugin 1.19.x). Cobertura real em docs/CAPACIDADES.md.
//  - tool precost_estimate: previa sob demanda (o modelo ou o usuario chama).
//  - event message.updated: registra tokens/custo reais por sessao (base do historico e do limite).
//  - tool.execute.before: com sessionLimitUsd, LANCA erro quando o gasto real da sessao passa do limite (bloqueio real de ferramenta).
//  - chat.message: com limitUsd, bloqueia o prompt (throw) e exige 'precost approve CODIGO'; sem limitUsd so registra a previa.
import { tool } from '@opencode-ai/plugin';
import { ledgerPath, stateDir } from '../../src/paths.js';
import { join } from 'node:path';
import { loadPrices } from '../../src/pricing.js';
import { estimate } from '../../src/estimate.js';
import { format } from '../../src/format.js';
import { SessionLedger } from '../../src/history.js';
import { decide, validateConfig, isCommand } from '../../src/gate.js';
import { filesFromParts } from '../../src/context.js';
import { tr, setLang } from '../../src/i18n.js';

export const PINNED_OPENCODE = '1.19.6';

export const PrecostPlugin = async (input = {}, options = {}) => {
  const client = input.client;
  setLang(options.lang);
  const prices = loadPrices(options.prices);
  const models = options.models ?? Object.keys(prices.models);
  const ledger = new SessionLedger(options.historyPath ?? ledgerPath());
  const histFor = (modelID) => ledger.list().filter((s) => s.turns > 0 && s.model && s.model === modelID && s.project === input.directory).map((s) => ({ input: s.input, output: s.output, cache_read: s.cache_read, cache_write: s.cache_write, turns: s.turns, peakCtx: s.peakCtx }));
  const histMap = (ms) => Object.fromEntries(ms.map((m) => [m, histFor(m)]));
  const run = (task) => {
    const hist = histMap(models);
    return format(estimate({ task, models, prices, history: hist, cacheHit: options.cacheHit ?? 0 }));
  };
  let cachedVersion;
  const version = async () => {
    if (options.version !== undefined) return options.version;
    if (cachedVersion) return cachedVersion;
    try { const r = await fetch(new URL('/global/health', input.serverUrl)); cachedVersion = (await r.json()).version; } catch { /* nao identificada */ }
    if (!cachedVersion) { // TUI: serverUrl e fantasma (localhost:4096 sem servidor). Fallback: perguntar ao proprio binario em execucao; se nao for o opencode, a saida nao casa e o gate falha FECHADO.
      try { const { execFileSync } = await import('node:child_process'); const o = execFileSync(process.execPath, ['--version'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (/^\d+\.\d+\.\d+/.test(o)) cachedVersion = o; } catch { /* nao identificada */ }
    }
    return cachedVersion;
  };
  return {
    tool: {
      precost_estimate: tool({
        description: 'Estimates the cost range (USD) of a task before running it. Separates known context from the estimated range.',
        args: { task: tool.schema.string().describe('description of the task to estimate') },
        async execute(args) { return run(args.task); },
      }),
    },
    event: async ({ event }) => {
      if (event.type !== 'message.updated') return;
      const m = event.properties.info;
      if (m.role === 'assistant' && m.time?.completed) ledger.record({ id: m.id, sessionID: m.sessionID, cost: m.cost, tokens: m.tokens, model: m.modelID, project: input.directory });
    },
    // Verificado em opencode 1.19.6 (docs/evidence-*): lancar aqui impede o prompt de entrar na sessao e de chegar ao modelo.
    // Efeito NAO documentado: por isso a versao e fixada (PINNED_OPENCODE) e verificada em runtime; versao diferente = FALHA FECHADA,
    // salvo options.allowUnverifiedVersion. O cliente recebe so erro generico; o texto tambem vai para toast (melhor esforco),
    // options.log e <stateDir>/last-block.txt (comando: precost last).
    'chat.message': async (inp, output) => {
      const gated = options.limitUsd !== undefined && options.limitUsd !== null;
      const text = (output.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      const deny = async (msg) => { try { await client?.tui?.showToast?.({ body: { message: msg.slice(0, 600), variant: 'warning' } }); } catch { /* sem TUI */ } const err = new Error(msg); err.precostDeny = true; throw err; };
      try {
        const root0 = input.directory ?? process.cwd();
        if (isCommand(text)) { // comandos do usuario: SEMPRE interceptados (nunca chegam ao modelo), com ou sem limite
          const c = decide({ prompt: text, model: inp.model?.modelID, session: inp.sessionID, config: { limitUsd: options.limitUsd, ttlMin: options.ttlMin, cacheHit: options.cacheHit, prices: options.prices, compare: options.compare, lang: options.lang }, stateDir: options.stateDir ?? stateDir(), history: histMap([inp.model?.modelID, ...(options.compare ?? [])].filter(Boolean)) });
          return await deny(c.text);
        }
        if (!gated) { if (text && options.log) options.log(run(text)); return; }
        const bad = validateConfig(options);
        if (bad) return await deny(tr(`precost: invalid configuration (${bad}). Blocked (fail closed).`, `precost: configuracao invalida (${bad}). Bloqueado (falha fechada).`));
        if (!options.allowUnverifiedVersion) {
          const v = await version(inp);
          if (v !== PINNED_OPENCODE) return await deny(tr(`precost: OpenCode version ${v ?? 'not identified'} differs from the verified one (${PINNED_OPENCODE}); blocking by throw is undocumented behavior. Blocked (fail closed). Validate with npm run e2e:opencode and set allowUnverifiedVersion:true at your own risk.`, `precost: versao do OpenCode ${v ?? 'nao identificada'} difere da verificada (${PINNED_OPENCODE}); o bloqueio por throw e comportamento nao documentado. Bloqueado (falha fechada). Valide com npm run e2e:opencode e use allowUnverifiedVersion:true por sua conta.`));
        }
        const root = root0;
        const fileParts = filesFromParts(output.parts, root);
        if (!text && fileParts.length === 0) return; // sem texto e sem arquivo: nada a avaliar

        const d = decide({ prompt: text ?? '', model: inp.model?.modelID, session: inp.sessionID, files: fileParts, config: { limitUsd: options.limitUsd, ttlMin: options.ttlMin, cacheHit: options.cacheHit, prices: options.prices, compare: options.compare, lang: options.lang }, stateDir: options.stateDir ?? stateDir(), history: histMap([inp.model?.modelID, ...(options.compare ?? [])].filter(Boolean)) });
        if (options.log) options.log(d.text);
        if (d.action === 'allow') return;
        return await deny(d.text);
      } catch (e) {
        if (e?.precostDeny) throw e;
        return await deny(tr(`precost: internal error (${e?.message}); blocked for safety (fail closed).`, `precost: erro interno (${e?.message}); bloqueado por seguranca (falha fechada).`));
      }
    },
    'tool.execute.before': async (input) => {
      if (options.sessionLimitUsd === undefined) return;
      if (typeof options.sessionLimitUsd !== 'number' || !Number.isFinite(options.sessionLimitUsd)) throw new Error(tr('precost: invalid sessionLimitUsd; blocked (fail closed).', 'precost: sessionLimitUsd invalido; bloqueado (falha fechada).'));
      const s = ledger.spent(input.sessionID);
      if (s > options.sessionLimitUsd) throw new Error(tr(`precost: session spend US$${s.toFixed(2)} passed the US$${options.sessionLimitUsd} limit. Raise the limit or start a new session.`, `precost: gasto da sessao US$${s.toFixed(2)} passou do limite US$${options.sessionLimitUsd}. Aumente o limite ou inicie nova sessao.`));
    },
  };
};
export default { id: 'opencode-precost', server: PrecostPlugin };
