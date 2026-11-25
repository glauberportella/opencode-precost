import { range, promoBenefit } from './estimate.js';
import { tr } from './i18n.js';
const usd = (n) => (n < 0.01 ? `US$${n.toFixed(4)}` : `US$${n.toFixed(2)}`);

export function format(result, { title = tr('Cost preview (ESTIMATE)', 'Previa de custo (ESTIMATIVA)') } = {}) {
  const k = result.initial;
  const L = [title];
  L.push(tr(`OBSERVED: ${k.observedChars} characters (prompt ${k.promptChars} + files ${k.fileChars}).`, `OBSERVADO: ${k.observedChars} caracteres (prompt ${k.promptChars} + arquivos ${k.fileChars}).`));
  L.push(tr(`ESTIMATED INITIAL CONTEXT: ~${k.estTokens} tokens = prompt ~${k.estPromptTokens} + files ~${k.estFileTokens} (${result.tokenMethod}) + ${k.assumedSystemTokens} system/tools (ASSUMPTION, not measured).`, `CONTEXTO INICIAL ESTIMADO: ~${k.estTokens} tokens = prompt ~${k.estPromptTokens} + arquivos ~${k.estFileTokens} (${result.tokenMethod}) + ${k.assumedSystemTokens} de sistema/ferramentas (PREMISSA, nao medida).`));
  const kindLabel = (k) => tr({ historico: 'history', premissas: 'assumptions', mista: 'mixed' }[k] ?? k, k);
  L.push(tr(`FULL TASK (basis: ${kindLabel(result.basis.kind)}): ${result.basis.note}.`, `TAREFA COMPLETA (base: ${result.basis.kind}): ${result.basis.note}.`));
  for (const r of result.rows) {
    if (r.error) { L.push(`- ${r.model}: ${r.error}`); continue; }
    const g = range(r);
    const mixed = result.basis.kind === 'mista';
    L.push(tr(`- ${r.model}${mixed ? ` [basis: ${kindLabel(r.basis.kind)}]` : ''}: initial context ~${usd(r.initialContextEstUsd)} (estimated); task ${r.lowerBound ? 'AT LEAST ' : ''}${usd(g.min)} to ${usd(g.max)}${r.lowerBound ? ' (lower bound only, long-context rate unknown)' : ''} (mid ${usd(g.mid)}; the high value is P75 / large scenario, NOT a cap)`, `- ${r.model}${mixed ? ` [base: ${r.basis.kind}]` : ''}: contexto inicial ~${usd(r.initialContextEstUsd)} (estimado); tarefa ${r.lowerBound ? 'AO MENOS ' : ''}${usd(g.min)} a ${usd(g.max)}${r.lowerBound ? ' (so limite inferior, taxa de contexto longo desconhecida)' : ''} (meio ${usd(g.mid)}; o valor alto e P75/cenario grande, NAO e teto)`) + (r.notes.length ? ` [${r.notes.join('; ')}]` : ''));
    const pb = promoBenefit(r);
    if (pb) L.push(tr(`  charge above = INFERRED GROSS (post-promotion list price; not validated against a primary billing source: conservative estimate, not an exact charge). Conditional benefit until ${pb.until}: ${pb.pct}% credits back on net spend (about ${usd(pb.minUsd)} to ${usd(pb.maxUsd)}), if it applies to the account. It is not an invoice discount; the gate uses the gross value.`, `  cobranca acima = BRUTA INFERIDA (preco de lista pos-promocao; sem validacao em fonte primaria de faturamento: estimativa conservadora, nao cobranca exata). Beneficio condicional ate ${pb.until}: ${pb.pct}% de creditos de volta sobre gasto liquido (ate ~${usd(pb.minUsd)} a ${usd(pb.maxUsd)}), se aplicavel a conta. Nao e desconto na fatura; o gate usa o valor bruto.`));
  }
  L.push(tr('Nothing here is a known cost or a guarantee: the agent still explores files, runs tests and may redo work.', 'Nada aqui e custo conhecido nem garantia: o agente ainda explora arquivos, roda testes e pode refazer trabalho.'));
  return L.join('\n');
}
