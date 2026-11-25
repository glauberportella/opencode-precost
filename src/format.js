import { range } from './estimate.js';
const usd = (n) => (n < 0.01 ? `US$${n.toFixed(4)}` : `US$${n.toFixed(2)}`);

export function format(result, { title = 'Previa de custo' } = {}) {
  const k = result.known;
  const L = [];
  L.push(`${title}`);
  L.push(`CONHECIDO (contexto inicial, contagem ${result.tokenMethod}): ${k.total} tokens = prompt ${k.promptTokens} + arquivos ${k.fileTokens} + sistema/ferramentas ${k.systemTokens} (premissa).`);
  L.push(`ESTIMADO (tarefa completa, base: ${result.basis.kind}): ${result.basis.note}.`);
  for (const r of result.rows) {
    if (r.error) { L.push(`- ${r.model}: ${r.error}`); continue; }
    const g = range(r);
    L.push(`- ${r.model}: contexto inicial ${usd(r.knownContextUsd)}; tarefa ${usd(g.min)} a ${usd(g.max)} (meio ${usd(g.mid)})` + (r.cacheNote ? ` [${r.cacheNote}]` : '') + (r.accessNote ? ` [acesso: ${r.accessNote}]` : ''));
  }
  L.push('Faixa nao e garantia: o agente ainda explora arquivos, roda testes e pode refazer trabalho.');
  return L.join('\n');
}
