#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadPrices } from '../src/pricing.js';
import { estimate } from '../src/estimate.js';
import { format } from '../src/format.js';

const { values } = parseArgs({ options: {
  task: { type: 'string' }, 'task-file': { type: 'string' }, file: { type: 'string', multiple: true },
  model: { type: 'string', multiple: true }, prices: { type: 'string' }, history: { type: 'string' },
  'cache-hit': { type: 'string' }, json: { type: 'boolean' }, date: { type: 'string' },
} });
const task = values.task ?? (values['task-file'] ? readFileSync(values['task-file'], 'utf8') : '');
if (!task) { console.error('uso: precost --task "..." [--file f]... [--model m]... [--history h.json] [--cache-hit 0.5] [--json]'); process.exit(2); }
const prices = loadPrices(values.prices);
const models = values.model ?? Object.keys(prices.models);
const history = values.history ? JSON.parse(readFileSync(values.history, 'utf8')) : undefined;
const res = estimate({ task, fileTexts: (values.file ?? []).map((f) => readFileSync(f, 'utf8')), models, prices, history, cacheHit: Number(values['cache-hit'] ?? 0), date: values.date });
console.log(values.json ? JSON.stringify(res, null, 2) : format(res));
