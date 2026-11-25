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
  assert.equal(priceAt(prices, 'gemini-4-carbon', '2026-11-30').input, 4); // bruto, nao o efetivo
  assert.equal(priceAt(prices, 'gemini-4-carbon', '2026-11-30').promo.credit_back_pct, 50);
  const after = priceAt(prices, 'gemini-4-carbon', '2026-12-01');
  assert.equal(after.input, 4); assert.equal(after.output, 20); assert.equal(after.promo, null);
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
  // P25/P75 do historico + entrada observada (1 token de prompt) somada uma vez
  assert.ok(Math.abs(g.min - ((200000 + 1) * 1.5 + 20000 * 7.5) / 1e6) < 1e-9);
  assert.ok(Math.abs(g.max - ((400000 + 1) * 1.5 + 40000 * 7.5) / 1e6) < 1e-9);
  const big = estimate({ task: 'x'.repeat(4_000_000), models: ['gemini-4-hydrogen'], prices, history: h });
  assert.ok(range(big.rows[0]).min > g.min + 1); // tamanho da entrada agora pesa no historico
  assert.equal(estimate({ task: 'x', models: ['gemini-4-hydrogen'], prices, history: h.slice(0, 3) }).basis.kind, 'premissas');
});
test('quantile', () => { assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3); });

import { promoBenefit } from '../src/estimate.js';
import { resolveModel } from '../src/pricing.js';
test('promocao: custo bruto separado do beneficio condicional (nunca preco efetivo como previsao)', () => {
  const r = estimate({ task: 'x', models: ['gemini-4-carbon'], prices, date: '2026-11-25' });
  const gross = range(r.rows[0]); const pb = promoBenefit(r.rows[0]);
  const after = range(estimate({ task: 'x', models: ['gemini-4-carbon'], prices, date: '2026-12-01' }).rows[0]);
  assert.ok(Math.abs(gross.max - after.max) < 1e-9); // bruto igual ao preco de lista
  assert.ok(Math.abs(pb.maxUsd - gross.max * 0.5) < 1e-9);
  assert.equal(promoBenefit(estimate({ task: 'x', models: ['gemini-4-carbon'], prices, date: '2026-12-01' }).rows[0]), null);
});
test('contexto longo: Gemini 4 sem faixa conhecida = limite inferior; 3.1 Pro aplica faixa; modelo de preco unico nao marca', () => {
  const t = 'x'.repeat(4_000_000); // ~1M tokens
  assert.equal(estimate({ task: t, models: ['gemini-4-neon'], prices }).rows[0].lowerBound, true);
  assert.equal(estimate({ task: t, models: ['claude-sonnet-5.5'], prices }).rows[0].lowerBound, false);
  assert.equal(estimate({ task: 'x', models: ['gemini-4-neon'], prices }).rows[0].lowerBound, true); // cenario grande (~360K) ja passa de 200K
  assert.equal(estimate({ task: 'x', models: ['gemini-3.5-flash'], prices }).rows[0].lowerBound, false);
});
test('resolucao de modelo Claude e limiar de 100K do Haiku 5.5', () => {
  assert.equal(resolveModel(prices, 'claude-sonnet-5-5-20261001'), 'claude-sonnet-5.5');
  assert.equal(resolveModel(prices, 'anthropic/claude-opus-5-5[1m]'), 'claude-opus-5.5');
  assert.equal(resolveModel(prices, 'modelo-x'), null);
  const a = costCalls(priceAt(prices, 'claude-haiku-5.5'), [{ ctx: 100000, cachedIn: 0, out: 0 }]).usd;
  const b = costCalls(priceAt(prices, 'claude-haiku-5.5'), [{ ctx: 100001, cachedIn: 0, out: 0 }]).usd;
  assert.ok(Math.abs(a - 0.01) < 1e-9); assert.ok(Math.abs(b - 0.0500005) < 1e-9);
});
