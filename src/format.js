import { range, promoBenefit } from './estimate.js';
const usd = (n) => (n < 0.01 ? `US$${n.toFixed(4)}` : `US$${n.toFixed(2)}`);

export function format(result, { title = 'Previa de custo (ESTIMATIVA)' } = {}) {
  const k = result.initial;
  const L = [title];
  L.push(`OBSERVADO: ${k.observedChars} caracteres (prompt ${k.promptChars} + arquivos ${k.fileChars}).`);
  L.push(`CONTEXTO INICIAL ESTIMADO: ~${k.estTokens} tokens = prompt ~${k.estPromptTokens} + arquivos ~${k.estFileTokens} (${result.tokenMethod}) + ${k.assumedSystemTokens} de sistema/ferramentas (PREMISSA, nao medida).`);
  L.push(`TAREFA COMPLETA (base: ${result.basis.kind}): ${result.basis.note}.`);
  for (const r of result.rows) {
    if (r.error) { L.push(`- ${r.model}: ${r.error}`); continue; }
    const g = range(r);
    L.push(`- ${r.model}: contexto inicial ~${usd(r.initialContextEstUsd)} (estimado); tarefa ${r.lowerBound ? 'AO MENOS ' : ''}${usd(g.min)} a ${usd(g.max)}${r.lowerBound ? ' (so limite inferior, taxa de contexto longo desconhecida)' : ''} (meio ${usd(g.mid)}; o valor alto e P75/cenario grande, NAO e teto)` + (r.notes.length ? ` [${r.notes.join('; ')}]` : ''));
    const pb = promoBenefit(r);
    if (pb) L.push(`  cobranca BRUTA acima. Beneficio condicional ate ${pb.until}: ${pb.pct}% de creditos de volta sobre gasto liquido (ate ~${usd(pb.minUsd)} a ${usd(pb.maxUsd)}), se aplicavel a conta. Nao e desconto na fatura; o gate usa o valor bruto.`);
  }
  L.push('Nada aqui e custo conhecido nem garantia: o agente ainda explora arquivos, roda testes e pode refazer trabalho.');
  return L.join('\n');
}
