import { range } from './estimate.js';
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
    L.push(`- ${r.model}: contexto inicial ~${usd(r.initialContextEstUsd)} (estimado); tarefa ${usd(g.min)} a ${usd(g.max)} (meio ${usd(g.mid)})` + (r.notes.length ? ` [${r.notes.join('; ')}]` : ''));
  }
  L.push('Nada aqui e custo conhecido nem garantia: o agente ainda explora arquivos, roda testes e pode refazer trabalho.');
  return L.join('\n');
}
