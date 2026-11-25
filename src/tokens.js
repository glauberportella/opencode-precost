// Contagem aproximada: caracteres / 4. E uma estimativa, nao o tokenizer do provedor.
// Troque por um contador real passando `counter` para estimate().
export function approxTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
import { tr } from './i18n.js';
export const tokenMethod = () => tr('chars/4 (approximate; the provider tokenizer may differ)', 'chars/4 (aproximado; tokenizer do provedor pode diferir)');
