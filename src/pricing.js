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
// Normaliza ids de modelo ("anthropic/claude-sonnet-5-5-20261001[1m]" -> "claude-sonnet-5.5"). Desconhecido continua desconhecido.
export function resolveModel(prices, id) {
  if (!id) return null;
  if (prices.models[id]) return id;
  const n = String(id).toLowerCase().replace(/^[a-z-]+\//, '').replace(/\[.*\]$/, '').replace(/-\d{8}$/, '').replace(/(\d)-(\d)/g, '$1.$2');
  return prices.models[n] ? n : null;
}
export function priceAt(prices, model, date = new Date().toISOString().slice(0, 10)) {
  const key = resolveModel(prices, model);
  const m = key && prices.models[key];
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
export function costCalls(price, calls, defaultThreshold = 200000) {
  const threshold = price.long_context_threshold ?? defaultThreshold;
  let usd = 0, cacheKnown = true, longUnknown = false;
  for (const c of calls) {
    const tier = typeof price.long_context === 'object' && price.long_context;
    const long = c.ctx > threshold && tier;
    if (c.ctx > threshold && price.long_context === 'unknown') longUnknown = true;
    const r = long ? { ...price, ...price.long_context } : price;
    const cachedRate = has(r.cache_read) ? r.cache_read : r.input;
    if (c.cachedIn > 0 && !has(r.cache_read)) cacheKnown = false;
    usd += ((c.ctx - c.cachedIn) * r.input + c.cachedIn * cachedRate + c.out * r.output) / 1e6;
  }
  return { usd, cacheKnown, longUnknown };
}

// Custo de totais agregados (historico real): nao ha ctx por chamada, entao so a taxa base.
export function costTotals(price, { freshIn, cachedIn = 0, out, turns }, defaultThreshold = 200000) {
  const threshold = price.long_context_threshold ?? defaultThreshold;
  const cacheKnown = has(price.cache_read) || cachedIn === 0;
  const cachedRate = has(price.cache_read) ? price.cache_read : price.input;
  // O limiar e POR CHAMADA: o total agregado nao diz o contexto de cada chamada. Usa a media por chamada (turns) como indicio:
  // media acima do limiar = limite inferior; abaixo = so nota de que o pico por chamada e desconhecido.
  let longUnknown = false;
  if (typeof price.long_context === 'object' || price.long_context === 'unknown') {
    const avg = turns > 0 ? (freshIn + cachedIn) / turns : null;
    longUnknown = avg === null ? true : avg > threshold ? true : `agregado: pico de contexto por chamada desconhecido (media ${Math.round(avg)} tokens/chamada, abaixo do limiar de ${threshold}); faixa longa nao aplicada`;
  }
  return { usd: (freshIn * price.input + cachedIn * cachedRate + out * price.output) / 1e6, cacheKnown, longUnknown };
}
