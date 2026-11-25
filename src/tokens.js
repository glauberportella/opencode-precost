// Contagem aproximada: caracteres / 4. E uma estimativa, nao o tokenizer do provedor.
// Troque por um contador real passando `counter` para estimate().
export function approxTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
export const TOKEN_METHOD = 'chars/4 (aproximado; tokenizer do provedor pode diferir)';
