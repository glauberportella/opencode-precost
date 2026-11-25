import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPrices, priceAt, costCalls } from '../src/pricing.js';
import { simulateCalls, totalsOf, estimate, quantile, range } from '../src/estimate.js';

const prices = loadPrices();

test('aritmetica conferida a mao (6 chamadas, base 8018, growth 2000, cache 50%, Hydrogen)', () => {
  const calls = simulateCalls({ base: 8018, turns: 6, outPerTurn: 500, growthPerTurn: 2000, cacheHit: 0.5 });
  const t = totalsOf(calls);
  assert.equal(t.cachedIn, 35045 + 0 /*arred. por chamada*/ - (35045 - t.cachedIn));
  assert.ok(Math.abs(t.freshIn + t.cachedIn - 78108) <= 1); // soma dos contextos = 6*8018 + 2000*15
  const c = costCalls(priceAt(prices, 'gemini-4-hydrogen'), calls);
  assert.ok(Math.abs(c.usd - 0.0897229) < 1e-4, String(c.usd));
});
test('preco muda por data e promo some (Carbon/3.8 Flash)', () => {
  assert.equal(priceAt(prices, 'gemini-3.8-flash', '2026-12-31').input, 0.75);
  assert.equal(priceAt(prices, 'gemini-3.8-flash', '2027-01-01').input, 1.5);
  assert.equal(priceAt(prices, 'gemini-3.8-flash', '2027-01-01').cache_read, 0.15);
  assert.equal(priceAt(prices, 'gemini-4-carbon', '2026-11-30').input, 2);
  const after = priceAt(prices, 'gemini-4-carbon', '2026-12-01');
  assert.equal(after.input, 4); assert.equal(after.output, 20); assert.equal(after.promo_credit, null);
});
test('contexto >200K: Pro Preview usa taxa longa em TODOS os tokens da chamada; modelo sem taxa longa e marcado desconhecido', () => {
  const pro = priceAt(prices, 'gemini-3.1-pro-preview');
  const call = [{ ctx: 300000, cachedIn: 0, out: 1000 }];
  const c = costCalls(pro, call);
  assert.ok(Math.abs(c.usd - (300000 * 4 + 1000 * 18) / 1e6) < 1e-9);
  const h = costCalls(priceAt(prices, 'gemini-4-hydrogen'), call);
  assert.equal(h.longUnknown, true);
});
test('modelo sem preco nao vira zero', () => {
  assert.match(estimate({ task: 'x', models: ['nao-existe'], prices }).rows[0].error, /n\/d/);
});
test('rotulos: observado = caracteres; tokens e custo sao estimativas', () => {
  const r = estimate({ task: 'abcd', models: ['gemini-4-hydrogen'], prices });
  assert.equal(r.initial.observedChars, 4); assert.equal(r.initial.assumedSystemTokens, 8000);
  assert.ok(r.rows[0].initialContextEstUsd > 0);
});
test('historico (>=5) usa quantis; <5 ignorado', () => {
  const h = [1, 2, 3, 4, 5].map((n) => ({ input: n * 100000, output: n * 10000, cache_read: 0 }));
  const r = estimate({ task: 'x', models: ['gemini-4-hydrogen'], prices, history: h });
  assert.equal(r.basis.kind, 'historico');
  const g = range(r.rows[0]);
  assert.ok(Math.abs(g.min - (200000 * 1.5 + 20000 * 7.5) / 1e6) < 1e-9);
  assert.ok(Math.abs(g.max - (400000 * 1.5 + 40000 * 7.5) / 1e6) < 1e-9);
  assert.equal(estimate({ task: 'x', models: ['gemini-4-hydrogen'], prices, history: h.slice(0, 3) }).basis.kind, 'premissas');
});
test('quantile', () => { assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3); });
