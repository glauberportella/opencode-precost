// Plugin OpenCode (API V1, pacote @opencode-ai/plugin 1.19.x). Cobertura real em docs/CAPACIDADES.md.
//  - tool precost_estimate: previa sob demanda (o modelo ou o usuario chama).
//  - event message.updated: registra tokens/custo reais por sessao (base do historico e do limite).
//  - tool.execute.before: com sessionLimitUsd, LANCA erro quando o gasto real da sessao passa do limite (bloqueio real de ferramenta).
//  - chat.message: com limitUsd, bloqueia o prompt (throw) e exige 'precost approve CODIGO'; sem limitUsd so registra a previa.
import { tool } from '@opencode-ai/plugin';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadPrices } from '../../src/pricing.js';
import { estimate } from '../../src/estimate.js';
import { format } from '../../src/format.js';
import { SessionLedger } from '../../src/history.js';
import { decide, validateConfig } from '../../src/gate.js';
import { filesFromParts } from '../../src/context.js';

export const PINNED_OPENCODE = '1.19.6';

export const PrecostPlugin = async (input = {}, options = {}) => {
  const client = input.client;
  const prices = loadPrices(options.prices);
  const models = options.models ?? Object.keys(prices.models);
  const ledger = new SessionLedger(options.historyPath ?? join(homedir(), '.local', 'share', 'precost', 'sessions.json'));
  const histFor = (modelID) => ledger.list().filter((s) => s.turns > 0 && s.model && s.model === modelID && s.project === input.directory).map((s) => ({ input: s.input, output: s.output, cache_read: s.cache_read, cache_write: s.cache_write, turns: s.turns, peakCtx: s.peakCtx }));
  const run = (task) => {
    const hist = histFor(models[0]);
    return format(estimate({ task, models, prices, history: hist, cacheHit: options.cacheHit ?? 0 }));
  };
  let cachedVersion;
  const version = async () => {
    if (options.version !== undefined) return options.version;
    if (cachedVersion) return cachedVersion;
    try { const r = await fetch(new URL('/global/health', input.serverUrl)); cachedVersion = (await r.json()).version; } catch { /* nao identificada */ }
    return cachedVersion;
  };
  return {
    tool: {
      precost_estimate: tool({
        description: 'Estima a faixa de custo (USD) de uma tarefa antes de executa-la. Separa contexto conhecido de faixa estimada.',
        args: { task: tool.schema.string().describe('descricao da tarefa a estimar') },
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
        if (!gated) { if (text && options.log) options.log(run(text)); return; }
        const bad = validateConfig(options);
        if (bad) return await deny(`precost: configuracao invalida (${bad}). Bloqueado (falha fechada).`);
        if (!options.allowUnverifiedVersion) {
          const v = await version(inp);
          if (v !== PINNED_OPENCODE) return await deny(`precost: versao do OpenCode ${v ?? 'nao identificada'} difere da verificada (${PINNED_OPENCODE}); o bloqueio por throw e comportamento nao documentado. Bloqueado (falha fechada). Valide com npm run e2e:opencode e use allowUnverifiedVersion:true por sua conta.`);
        }
        if (!text) return;
        const root = input.directory ?? process.cwd();
        const d = decide({ prompt: text, model: inp.model?.modelID, session: inp.sessionID, files: filesFromParts(output.parts, root), config: { limitUsd: options.limitUsd, ttlMin: options.ttlMin, cacheHit: options.cacheHit, prices: options.prices, compare: options.compare }, stateDir: options.stateDir ?? join(homedir(), '.cache', 'precost'), history: histFor(inp.model?.modelID) });
        if (options.log) options.log(d.text);
        if (d.action === 'allow') return;
        return await deny(d.text);
      } catch (e) {
        if (e?.precostDeny) throw e;
        return await deny(`precost: erro interno (${e?.message}); bloqueado por seguranca (falha fechada).`);
      }
    },
    'tool.execute.before': async (input) => {
      if (options.sessionLimitUsd === undefined) return;
      if (typeof options.sessionLimitUsd !== 'number' || !Number.isFinite(options.sessionLimitUsd)) throw new Error('precost: sessionLimitUsd invalido; bloqueado (falha fechada).');
      const s = ledger.spent(input.sessionID);
      if (s > options.sessionLimitUsd) throw new Error(`precost: gasto da sessao US$${s.toFixed(2)} passou do limite US$${options.sessionLimitUsd}. Aumente o limite ou inicie nova sessao.`);
    },
  };
};
export default { id: 'opencode-precost', server: PrecostPlugin };
