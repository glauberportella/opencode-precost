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
  const pick = (q) => ({ freshIn: Math.round(quantile(col('input'), q)), cachedIn: Math.round(quantile(col('cache_read'), q)), out: Math.round(quantile(col('output'), q)), cacheWrite: Math.round(quantile(col('cache_write'), q)), turns: Math.max(1, Math.round(quantile(col('turns'), q))), peak: history.every((h) => typeof h.peakCtx === 'number') ? Math.max(...history.map((h) => h.peakCtx)) : undefined /* MAIOR pico registrado, nao quantil */ });
  return { low: pick(0.25), mid: pick(0.5), high: pick(0.75) };
}

export function estimate({ task = '', fileTexts = [], models, prices, history, cacheHit = 0, systemTokens = DEFAULT_SYSTEM_TOKENS, date, counter = approxTokens }) {
  const promptChars = task.length, fileChars = fileTexts.reduce((s, t) => s + t.length, 0);
  const promptTokens = counter(task), fileTokens = fileTexts.reduce((s, t) => s + counter(t), 0);
  // OBSERVADO: so os caracteres lidos. Tokens e custo abaixo sao ESTIMATIVAS (chars/4 + premissa de sistema).
  const initial = { observedChars: promptChars + fileChars, promptChars, fileChars, estTokens: promptTokens + fileTokens + systemTokens, estPromptTokens: promptTokens, estFileTokens: fileTokens, assumedSystemTokens: systemTokens };
  const threshold = prices.long_context_threshold_tokens ?? 200000;

  // Cenarios por modelo: o multiplicador de tokenizador (Claude 4.7+, ~30%) so afeta os tokens observados (prompt/arquivos), nao a premissa de sistema.
  // history: lista (vale para todas as linhas) ou mapa {modelo: lista} (cada linha usa so o seu; sem mistura entre modelos comparados).
  const histOf = (model) => (Array.isArray(history) ? history : history?.[model]);
  const build = (mult, hist) => {
    const pT = Math.round(promptTokens * mult), fT = Math.round(fileTokens * mult);
    if (hist && hist.length >= 5) {
      const sc = fromHistory(hist);
      for (const s of Object.values(sc)) s.freshIn += pT + fT; // entrada observada desta tarefa somada uma vez
      return sc;
    }
    const sc = {};
    for (const [name, k] of Object.entries(DEFAULT_SCENARIOS)) sc[name] = simulateCalls({ base: pT + fT + systemTokens, ...k, cacheHit });
    return sc;
  };
  const basisOf = (hist) => (hist && hist.length >= 5
    ? { kind: 'historico', sessions: hist.length, note: 'P25/P50/P75 de sessoes anteriores deste modelo e projeto, mais a entrada observada desta tarefa somada uma vez; pico por chamada = MAIOR registrado; o historico nao depende do tamanho da tarefa alem disso. Semantica input/cache dos eventos reais NAO validada contra resposta de modelo' }
    : { kind: 'premissas', note: hist?.length ? `historico com ${hist.length} sessoes (<5) ignorado` : 'sem historico: tres cenarios com premissas fixas, nao medidas', scenarios: DEFAULT_SCENARIOS, cacheHit });

  const rows = models.map((model) => {
    const price = priceAt(prices, model, date);
    if (!price || typeof price.input !== 'number' || typeof price.output !== 'number') return { model, error: 'sem preco na tabela (n/d, nao tratado como zero)' };
    const scenarios = {}, notes = [];
    let lowerBound = false;
    const mult = price.tokenizer_multiplier ?? 1;
    const hist = histOf(model);
    const scen = build(mult, hist);
    const base = Math.round(promptTokens * mult) + Math.round(fileTokens * mult) + systemTokens;
    for (const [name, u] of Object.entries(scen)) {
      const c = Array.isArray(u) ? costCalls(price, u, threshold) : costTotals(price, u, threshold);
      scenarios[name] = { usd: c.usd, tokens: Array.isArray(u) ? totalsOf(u) : u };
      if (c.longUnknown === true) lowerBound = true;
      if (!c.cacheKnown) notes.push('sem preco de cache na tabela: entrada em cache cobrada a preco cheio (limite superior)');
      if (c.longUnknown) notes.push(typeof c.longUnknown === 'string' ? c.longUnknown : 'contexto acima do limiar: tabela nao traz taxa longa (desconhecido)');
    }
    if (mult !== 1) notes.push(`tokens observados x${mult} (tokenizador novo, ~30% a mais; ${'premissa da nota oficial'})`);
    if (price.cache_write_5m) notes.push(`conservador: toda entrada nova cobrada como cache write 5min (US$${price.cache_write_5m}/1M); economia real do cache nao creditada alem da leitura`);
    if (price.access_note) notes.push(`acesso: ${price.access_note}`);
    if (price.cache_write) notes.push(`cache write (US$${price.cache_write}/1M a partir de ${price.cache_write_from}) nao modelado`);
    const initialUsd = costCalls(price, [{ ctx: base, cachedIn: 0, out: 0 }], threshold).usd;
    const promoActive = price.promo ? { ...price.promo } : null;
    return { model, basis: basisOf(hist), lowerBound, promo: promoActive, price: { input: price.input, output: price.output, cache_read: price.cache_read ?? null }, initialContextEstUsd: initialUsd, scenarios, notes: [...new Set(notes)] };
  });
  const ok = rows.filter((r) => !r.error), kinds = new Set(ok.map((r) => r.basis.kind));
  const basis = kinds.size === 1 ? ok[0].basis : kinds.size === 0 ? basisOf(undefined) : { kind: 'mista', note: 'ver a base de cada modelo abaixo (historico so onde ha 5+ sessoes do proprio modelo e projeto)' };
  return { tokenMethod: TOKEN_METHOD, initial, basis, rows, pricesHash: prices._hash ?? null };
}

// Beneficio condicional da promocao (credito), SEPARADO da cobranca bruta. Nao e previsao da fatura.
export function promoBenefit(row) {
  if (!row.promo?.credit_back_pct) return null;
  const g = range(row);
  const f = row.promo.credit_back_pct / 100;
  return { until: row.promo.until, pct: row.promo.credit_back_pct, minUsd: g.min * f, maxUsd: g.max * f };
}
export function range(row) {
  const v = Object.values(row.scenarios).map((s) => s.usd).sort((a, b) => a - b);
  return { min: v[0], mid: v[Math.floor((v.length - 1) / 2)], max: v[v.length - 1] };
}
