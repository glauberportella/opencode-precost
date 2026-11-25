// Plugin OpenCode (API V1, pacote @opencode-ai/plugin 1.19.x). Cobertura real em docs/CAPACIDADES.md.
//  - tool precost_estimate: previa sob demanda (o modelo ou o usuario chama).
//  - event message.updated: registra tokens/custo reais por sessao (base do historico e do limite).
//  - tool.execute.before: com sessionLimitUsd, LANCA erro quando o gasto real da sessao passa do limite (bloqueio real de ferramenta).
//  - chat.message: so calcula e registra a previa; sem API para recusar o prompt neste hook.
import { tool } from '@opencode-ai/plugin';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadPrices } from '../../src/pricing.js';
import { estimate } from '../../src/estimate.js';
import { format } from '../../src/format.js';
import { SessionLedger } from '../../src/history.js';

export const PrecostPlugin = async (_input, options = {}) => {
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
    'chat.message': async (_in, output) => {
      const text = (output.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      if (text && options.log) options.log(run(text));
    },
    'tool.execute.before': async (input) => {
      if (typeof options.sessionLimitUsd !== 'number') return;
      const s = ledger.spent(input.sessionID);
      if (s > options.sessionLimitUsd) throw new Error(`precost: gasto da sessao US$${s.toFixed(2)} passou do limite US$${options.sessionLimitUsd}. Aumente o limite ou inicie nova sessao.`);
    },
  };
};
export default { id: 'opencode-precost', server: PrecostPlugin };
