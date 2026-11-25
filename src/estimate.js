import { approxTokens, TOKEN_METHOD } from './tokens.js';
import { priceAt, costCalls, costTotals } from './pricing.js';

// Premissas padrao (NAO medidas). Aparecem no resultado.
export const DEFAULT_SCENARIOS = {
  pequena: { turns: 6, outPerTurn: 500, growthPerTurn: 2000 },
  media: { turns: 18, outPerTurn: 900, growthPerTurn: 4000 },
  grande: { turns: 45, outPerTurn: 1500, growthPerTurn: 8000 },
};
export const DEFAULT_SYSTEM_TOKENS = 8000; // premissa: prompt do sistema + ferramentas

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Lista de chamadas simuladas: chamada i le base + (i-1)*growth; a primeira sem cache.
export function simulateCalls({ base, turns, outPerTurn, growthPerTurn, cacheHit }) {
  const calls = [];
  for (let i = 1; i <= turns; i++) {
    const ctx = Math.round(base + (i - 1) * growthPerTurn);
    calls.push({ ctx, cachedIn: i === 1 ? 0 : Math.round(ctx * cacheHit), out: outPerTurn });
  }
  return calls;
}
export function totalsOf(calls) {
  const t = calls.reduce((s, c) => ({ freshIn: s.freshIn + c.ctx - c.cachedIn, cachedIn: s.cachedIn + c.cachedIn, out: s.out + c.out }), { freshIn: 0, cachedIn: 0, out: 0 });
  return { ...t, turns: calls.length };
}

function fromHistory(history) {
  const col = (k) => history.map((h) => h[k] ?? 0).sort((a, b) => a - b);
  const pick = (q) => ({ freshIn: Math.round(quantile(col('input'), q)), cachedIn: Math.round(quantile(col('cache_read'), q)), out: Math.round(quantile(col('output'), q)) });
  return { low: pick(0.25), mid: pick(0.5), high: pick(0.75) };
}

export function estimate({ task = '', fileTexts = [], models, prices, history, cacheHit = 0, systemTokens = DEFAULT_SYSTEM_TOKENS, date, counter = approxTokens }) {
  const promptChars = task.length, fileChars = fileTexts.reduce((s, t) => s + t.length, 0);
  const promptTokens = counter(task), fileTokens = fileTexts.reduce((s, t) => s + counter(t), 0);
  // OBSERVADO: so os caracteres lidos. Tokens e custo abaixo sao ESTIMATIVAS (chars/4 + premissa de sistema).
  const initial = { observedChars: promptChars + fileChars, promptChars, fileChars, estTokens: promptTokens + fileTokens + systemTokens, estPromptTokens: promptTokens, estFileTokens: fileTokens, assumedSystemTokens: systemTokens };
  const base = initial.estTokens;
  const threshold = prices.long_context_threshold_tokens ?? 200000;

  let basis, scen;
  if (history && history.length >= 5) {
    scen = fromHistory(history);
    basis = { kind: 'historico', sessions: history.length, note: 'P25/P50/P75 de sessoes anteriores informadas; nao ajustado ao tamanho desta tarefa' };
  } else {
    scen = {};
    for (const [name, k] of Object.entries(DEFAULT_SCENARIOS)) scen[name] = simulateCalls({ base, ...k, cacheHit });
    basis = { kind: 'premissas', note: history?.length ? `historico com ${history.length} sessoes (<5) ignorado` : 'sem historico: tres cenarios com premissas fixas, nao medidas', scenarios: DEFAULT_SCENARIOS, cacheHit };
  }

  const rows = models.map((model) => {
    const price = priceAt(prices, model, date);
    if (!price || typeof price.input !== 'number' || typeof price.output !== 'number') return { model, error: 'sem preco na tabela (n/d, nao tratado como zero)' };
    const scenarios = {}, notes = [];
    for (const [name, u] of Object.entries(scen)) {
      const c = Array.isArray(u) ? costCalls(price, u, threshold) : costTotals(price, u);
      scenarios[name] = { usd: c.usd, tokens: Array.isArray(u) ? totalsOf(u) : u };
      if (!c.cacheKnown) notes.push('sem preco de cache na tabela: entrada em cache cobrada a preco cheio (limite superior)');
      if (c.longUnknown) notes.push(typeof c.longUnknown === 'string' ? c.longUnknown : 'contexto >200K: tabela nao traz taxa longa (desconhecido)');
    }
    if (price.promo_credit) notes.push(`promocao: ${price.promo_credit}`);
    if (price.access_note) notes.push(`acesso: ${price.access_note}`);
    if (price.cache_write) notes.push(`cache write (US$${price.cache_write}/1M a partir de ${price.cache_write_from}) nao modelado`);
    const initialUsd = costCalls(price, [{ ctx: base, cachedIn: 0, out: 0 }], threshold).usd;
    return { model, price: { input: price.input, output: price.output, cache_read: price.cache_read ?? null }, initialContextEstUsd: initialUsd, scenarios, notes: [...new Set(notes)] };
  });
  return { tokenMethod: TOKEN_METHOD, initial, basis, rows, pricesHash: prices._hash ?? null };
}

export function range(row) {
  const v = Object.values(row.scenarios).map((s) => s.usd).sort((a, b) => a - b);
  return { min: v[0], mid: v[Math.floor((v.length - 1) / 2)], max: v[v.length - 1] };
}
