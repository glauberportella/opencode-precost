import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { userPricesPath } from './paths.js';
import { validatePrices, tableDate } from './prices-update.js';
import { tr } from './i18n.js';
const BUNDLED = fileURLToPath(new URL('../data/prices.json', import.meta.url));

// Sem caminho explicito: usa a tabela do usuario (precost update-prices) se for valida e NAO mais antiga que a embutida;
// caso contrario a embutida. Caminho explicito (config.prices / --prices) manda e falha se ilegivel.
function pick(path) {
  if (path) return { p: path, source: 'explicit' };
  try {
    const up = userPricesPath(); const raw = readFileSync(up, 'utf8'); const t = JSON.parse(raw);
    if (!validatePrices(t)) { const b = JSON.parse(readFileSync(BUNDLED, 'utf8')); if ((tableDate(t) ?? '') >= (tableDate(b) ?? '')) return { p: up, source: 'user', raw }; }
  } catch { /* sem tabela do usuario ou invalida: embutida */ }
  return { p: BUNDLED, source: 'bundled' };
}
export function loadPrices(path) {
  const { p, source } = pick(path);
  const raw = readFileSync(p, 'utf8');
  const prices = JSON.parse(raw);
  prices._source = { kind: source, path: p };
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
    const freshRate = r.cache_write_5m ?? r.input; // conservador: entrada nova como cache write quando o preco existe
    usd += ((c.ctx - c.cachedIn) * freshRate + c.cachedIn * cachedRate + c.out * r.output) / 1e6;
  }
  return { usd, cacheKnown, longUnknown };
}

// Custo de totais agregados (historico real): nao ha ctx por chamada, entao so a taxa base.
export function costTotals(price, { freshIn, cachedIn = 0, out, peak, cacheWrite = 0 }, defaultThreshold = 200000) {
  const threshold = price.long_context_threshold ?? defaultThreshold;
  const cacheKnown = has(price.cache_read) || cachedIn === 0;
  const cachedRate = has(price.cache_read) ? price.cache_read : price.input;
  // O limiar e POR CHAMADA e o total agregado nao diz o contexto de cada chamada. Media por chamada nao prova ausencia de picos.
  // So com pico REAL registrado (peak) da pra afirmar: pico acima do limiar = limite inferior; abaixo = sem faixa longa.
  // Pico desconhecido = incerteza: limite inferior (exige aprovacao no gate).
  let longUnknown = false;
  if (typeof price.long_context === 'object' || price.long_context === 'unknown') {
    if (typeof peak !== 'number') longUnknown = true;
    else if (peak > threshold) longUnknown = true;
    else longUnknown = tr(`recorded real peak ${peak} tokens/call, below the ${threshold} threshold: the long-context tier does not apply to the history`, `pico real registrado ${peak} tokens/chamada, abaixo do limiar ${threshold}: faixa longa nao se aplica ao historico`);
  }
  const w = price.cache_write_5m ?? price.input;
  return { usd: (freshIn * (price.cache_write_5m ?? price.input) + cacheWrite * w + cachedIn * cachedRate + out * price.output) / 1e6, cacheKnown, longUnknown };
}
