import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function loadPrices(path) {
  const p = path ?? fileURLToPath(new URL('../data/prices.json', import.meta.url));
  const raw = readFileSync(p, 'utf8');
  const prices = JSON.parse(raw);
  prices._hash = createHash('sha256').update(raw).digest('hex').slice(0, 16); // entra no vinculo da aprovacao
  return prices;
}

// Preco vigente numa data (yyyy-mm-dd). Campo ausente continua ausente.
export function priceAt(prices, model, date = new Date().toISOString().slice(0, 10)) {
  const m = prices.models[model];
  if (!m) return null;
  let cur = { ...m };
  for (const ch of (m.changes ?? []).slice().sort((a, b) => a.from.localeCompare(b.from))) {
    if (date >= ch.from) cur = { ...cur, ...ch };
  }
  return cur;
}

const has = (v) => typeof v === 'number';

// Custo de uma lista de chamadas [{ctx, cachedIn, out}] (ctx = tokens de entrada da chamada).
// Acima do limiar, todos os tokens da chamada usam a taxa longa (se a tabela a tiver).
export function costCalls(price, calls, threshold = 200000) {
  let usd = 0, cacheKnown = true, longUnknown = false;
  for (const c of calls) {
    const long = c.ctx > threshold && price.long_context;
    if (c.ctx > threshold && !price.long_context) longUnknown = true;
    const r = long ? { ...price, ...price.long_context } : price;
    const cachedRate = has(r.cache_read) ? r.cache_read : r.input;
    if (c.cachedIn > 0 && !has(r.cache_read)) cacheKnown = false;
    usd += ((c.ctx - c.cachedIn) * r.input + c.cachedIn * cachedRate + c.out * r.output) / 1e6;
  }
  return { usd, cacheKnown, longUnknown };
}

// Custo de totais agregados (historico real): nao ha ctx por chamada, entao so a taxa base.
export function costTotals(price, { freshIn, cachedIn = 0, out }) {
  const cacheKnown = has(price.cache_read) || cachedIn === 0;
  const cachedRate = has(price.cache_read) ? price.cache_read : price.input;
  return { usd: (freshIn * price.input + cachedIn * cachedRate + out * price.output) / 1e6, cacheKnown, longUnknown: Boolean(price.long_context) ? 'agregado: faixa >200K nao aplicada' : false };
}
