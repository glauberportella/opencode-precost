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
import { decide } from '../../src/gate.js';

export const PrecostPlugin = async (input = {}, options = {}) => {
  const client = input.client;
  const prices = loadPrices(options.prices);
  const models = options.models ?? Object.keys(prices.models);
  const ledger = new SessionLedger(options.historyPath ?? join(homedir(), '.local', 'share', 'precost', 'sessions.json'));
  const run = (task) => {
    const hist = ledger.list().filter((s) => s.turns > 0).map((s) => ({ input: s.input, output: s.output, cache_read: s.cache_read }));
    return format(estimate({ task, models, prices, history: hist, cacheHit: options.cacheHit ?? 0 }));
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
      if (m.role === 'assistant' && m.time?.completed) ledger.record({ id: m.id, sessionID: m.sessionID, cost: m.cost, tokens: m.tokens });
    },
    // Verificado em opencode 1.19.6 (docs/evidence-*): lancar aqui impede o prompt de entrar na sessao e de chegar ao modelo.
    // O cliente recebe so um erro generico ("Unexpected server error"); por isso o texto tambem vai para toast (melhor esforco) e options.log.
    'chat.message': async (input, output) => {
      const text = (output.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      if (!text) return;
      if (typeof options.limitUsd !== 'number') { if (options.log) options.log(run(text)); return; }
      const d = decide({ prompt: text, model: input.model?.modelID, session: input.sessionID, config: { limitUsd: options.limitUsd, ttlMin: options.ttlMin, cacheHit: options.cacheHit, prices: options.prices }, stateDir: options.stateDir ?? join(homedir(), '.cache', 'precost'), history: ledger.list().filter((s) => s.turns > 0).map((s) => ({ input: s.input, output: s.output, cache_read: s.cache_read })) });
      if (options.log) options.log(d.text);
      if (d.action === 'allow') return;
      try { await client?.tui?.showToast?.({ body: { message: d.text.slice(0, 600), variant: 'warning' } }); } catch { /* sem TUI conectado */ }
      throw new Error(d.text);
    },
    'tool.execute.before': async (input) => {
      if (typeof options.sessionLimitUsd !== 'number') return;
      const s = ledger.spent(input.sessionID);
      if (s > options.sessionLimitUsd) throw new Error(`precost: gasto da sessao US$${s.toFixed(2)} passou do limite US$${options.sessionLimitUsd}. Aumente o limite ou inicie nova sessao.`);
    },
  };
};
export default { id: 'opencode-precost', server: PrecostPlugin };
