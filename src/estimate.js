import { approxTokens, TOKEN_METHOD } from './tokens.js';
import { priceAt, costUSD } from './pricing.js';

// Premissas padrao (NAO medidas). Aparecem no resultado para ninguem confundir com dado real.
export const DEFAULT_SCENARIOS = {
  pequena: { turns: 6, outPerTurn: 500, growthPerTurn: 2000 },
  media: { turns: 18, outPerTurn: 900, growthPerTurn: 4000 },
  grande: { turns: 45, outPerTurn: 1500, growthPerTurn: 8000 },
};
export const DEFAULT_SYSTEM_TOKENS = 8000; // prompt do sistema + definicoes de ferramentas (premissa)

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Tokens de uma sessao simulada: turno i le base + (i-1)*growth; turno 1 sem cache.
export function simulate({ base, turns, outPerTurn, growthPerTurn, cacheHit }) {
  let freshIn = 0, cachedIn = 0, out = 0;
  for (let i = 1; i <= turns; i++) {
    const ctx = base + (i - 1) * growthPerTurn;
    const hit = i === 1 ? 0 : cacheHit;
    cachedIn += ctx * hit;
    freshIn += ctx * (1 - hit);
    out += outPerTurn;
  }
  return { freshIn: Math.round(freshIn), cachedIn: Math.round(cachedIn), out: Math.round(out), turns };
}

// history: [{ input, output, cache_read? }] por sessao concluida (tokens reais cobrados).
function fromHistory(history) {
  const col = (k) => history.map((h) => h[k] ?? 0).sort((a, b) => a - b);
  const pick = (q) => {
    const input = quantile(col('input'), q), cache = quantile(col('cache_read'), q), out = quantile(col('output'), q);
    return { freshIn: Math.round(input), cachedIn: Math.round(cache), out: Math.round(out) };
  };
  return { low: pick(0.25), mid: pick(0.5), high: pick(0.75) };
}

export function estimate({ task = '', fileTexts = [], models, prices, history, cacheHit = 0, systemTokens = DEFAULT_SYSTEM_TOKENS, date, counter = approxTokens }) {
  const promptTokens = counter(task);
  const fileTokens = fileTexts.reduce((s, t) => s + counter(t), 0);
  const known = { promptTokens, fileTokens, systemTokens, total: promptTokens + fileTokens + systemTokens };
  const base = known.total;

  let usage, basis;
  if (history && history.length >= 5) {
    usage = fromHistory(history);
    basis = { kind: 'historico', sessions: history.length, note: 'P25/P50/P75 de sessoes anteriores informadas; nao ajustado ao tamanho desta tarefa' };
  } else {
    usage = {};
    for (const [name, k] of Object.entries(DEFAULT_SCENARIOS)) {
      usage[name] = simulate({ base, ...k, cacheHit });
    }
    basis = {
      kind: 'premissas',
      note: history?.length ? `historico com ${history.length} sessoes (<5) ignorado` : 'sem historico: tres cenarios com premissas fixas, nao medidas',
      scenarios: DEFAULT_SCENARIOS, cacheHit,
    };
  }

  const rows = models.map((model) => {
    const price = priceAt(prices, model, date);
    if (!price || typeof price.input !== 'number' || typeof price.output !== 'number') {
      return { model, error: 'sem preco na tabela (n/d, nao tratado como zero)' };
    }
    const scen = {};
    let cacheKnown = true;
    for (const [name, u] of Object.entries(usage)) {
      const c = costUSD(price, u);
      cacheKnown = cacheKnown && c.cacheKnown;
      scen[name] = { usd: c.usd, tokens: u };
    }
    // custo conhecido: so o contexto inicial, 1 chamada, sem cache
    const knownUsd = costUSD(price, { freshIn: base, out: 0 }).usd;
    return { model, price: { input: price.input, output: price.output, cache_read: price.cache_read ?? null }, knownContextUsd: knownUsd, scenarios: scen, cacheNote: cacheKnown ? null : 'sem preco de cache na tabela: entrada em cache cobrada a preco cheio (limite superior)', accessNote: price.access_note ?? null };
  });
  return { tokenMethod: TOKEN_METHOD, known, basis, rows };
}

// Faixa [min,max] e o cenario "do meio" por modelo, para decisao/limite.
export function range(row) {
  const v = Object.values(row.scenarios).map((s) => s.usd).sort((a, b) => a - b);
  return { min: v[0], mid: v[Math.floor((v.length - 1) / 2)], max: v[v.length - 1] };
}
