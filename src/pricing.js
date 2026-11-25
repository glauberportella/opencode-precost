import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadPrices(path) {
  const p = path ?? fileURLToPath(new URL('../data/prices.json', import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Preco vigente numa data (ISO yyyy-mm-dd). Campo ausente continua ausente.
export function priceAt(prices, model, date = new Date().toISOString().slice(0, 10)) {
  const m = prices.models[model];
  if (!m) return null;
  let cur = { ...m };
  for (const ch of (m.changes ?? []).slice().sort((a, b) => a.from.localeCompare(b.from))) {
    if (date >= ch.from) cur = { ...cur, ...ch };
  }
  return cur;
}

// Custo em USD. cache_read ausente => cache tratado como "sem preco": cai para preco de entrada cheio
// e o resultado marca cacheAssumed=false.
export function costUSD(price, { freshIn, cachedIn = 0, out }) {
  const cacheKnown = typeof price.cache_read === 'number';
  const cachedRate = cacheKnown ? price.cache_read : price.input;
  const usd = (freshIn * price.input + cachedIn * cachedRate + out * price.output) / 1e6;
  return { usd, cacheKnown };
}
