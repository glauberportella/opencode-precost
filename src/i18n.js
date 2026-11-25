// Idioma das mensagens impressas pela ferramenta. Padrao: ingles. Escolha: config.lang ("en" | "pt"), senao PRECOST_LANG, senao "en".
// Somente o TEXTO muda. Comandos (precost approve CODE ...), codigos, chaves de config e o comportamento do gate nao dependem do idioma.
let current = null;
export const resolveLang = (v) => {
  const x = String(v ?? process.env.PRECOST_LANG ?? 'en').toLowerCase();
  return x.startsWith('pt') ? 'pt' : 'en';
};
export const setLang = (v) => { current = resolveLang(v); return current; };
export const lang = () => current ?? resolveLang();
// tr(en, pt): as duas versoes sao montadas no ponto de uso; so uma e devolvida.
export const tr = (en, pt) => (lang() === 'pt' ? pt : en);
