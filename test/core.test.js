import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPrices, priceAt, costUSD } from '../src/pricing.js';
import { simulate, estimate, quantile, range } from '../src/estimate.js';

const prices = loadPrices();

test('simulate: aritmetica conferida a mao (6 turnos, base 8018, growth 2000, cache 50%)', () => {
  const s = simulate({ base: 8018, turns: 6, outPerTurn: 500, growthPerTurn: 2000, cacheHit: 0.5 });
  assert.equal(s.freshIn, 43063); // 8018 + 0.5*(70090)
  assert.equal(s.cachedIn, 35045);
  assert.equal(s.out, 3000);
  const c = costUSD(priceAt(prices, 'gemini-4-hydrogen'), s);
  // (43063*1.5 + 35045*0.075 + 3000*7.5)/1e6
  assert.ok(Math.abs(c.usd - 0.0897229) < 1e-6, String(c.usd));
});
test('preco muda por data (3.8 flash)', () => {
  assert.equal(priceAt(prices, 'gemini-3.8-flash', '2026-12-31').input, 0.75);
  assert.equal(priceAt(prices, 'gemini-3.8-flash', '2027-01-01').input, 1.5);
});
test('modelo sem preco nao vira zero', () => {
  const r = estimate({ task: 'x', models: ['nao-existe'], prices });
  assert.match(r.rows[0].error, /n\/d/);
});
test('sem preco de cache: marca limite superior, nao zero', () => {
  const r = estimate({ task: 'x', models: ['gemini-3.8-flash'], prices, cacheHit: 0.9 });
  assert.ok(r.rows[0].cacheNote);
});
test('historico (>=5) usa quantis; <5 e ignorado', () => {
  const h = [1, 2, 3, 4, 5].map((n) => ({ input: n * 100000, output: n * 10000, cache_read: 0 }));
  const r = estimate({ task: 'x', models: ['gemini-4-hydrogen'], prices, history: h });
  assert.equal(r.basis.kind, 'historico');
  const g = range(r.rows[0]);
  assert.ok(Math.abs(g.min - (200000 * 1.5 + 20000 * 7.5) / 1e6) < 1e-9); // P25 = 2o valor
  assert.ok(Math.abs(g.max - (400000 * 1.5 + 40000 * 7.5) / 1e6) < 1e-9); // P75 = 4o
  assert.equal(estimate({ task: 'x', models: ['gemini-4-hydrogen'], prices, history: h.slice(0, 3) }).basis.kind, 'premissas');
});
test('quantile', () => { assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3); });
