#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadPrices } from '../src/pricing.js';
import { estimate } from '../src/estimate.js';
import { format } from '../src/format.js';

if (process.argv[2] === 'last') { // ultima mensagem de bloqueio (UX quando o cliente so mostra erro generico)
  try { console.log((() => { const d = process.env.PRECOST_STATE ?? join(homedir(), '.cache', 'precost'); const fs = readdirSync(d).filter((f) => /^last-block-/.test(f)).map((f) => [f, statSync(join(d, f)).mtimeMs]).sort((a, b) => b[1] - a[1]); return fs.length ? '(ultimo bloqueio de qualquer sessao: ' + fs[0][0] + ')\n' + readFileSync(join(d, fs[0][0]), 'utf8') : (() => { throw 0; })(); })()); } catch { console.log('precost: sem bloqueio registrado.'); }
  process.exit(0);
}
if (process.argv[2] === 'estimate' && process.argv[3] && !process.argv[3].startsWith('--')) { // precost estimate "tarefa" [--model m]: usa model do config se existir
  let cfg = {}; try { cfg = JSON.parse(readFileSync(process.env.PRECOST_CONFIG ?? join(homedir(), '.config', 'precost', 'config.json'), 'utf8')); } catch { /* sem config */ }
  const rest = process.argv.slice(4);
  process.argv.splice(2, 2, '--task', process.argv[3], ...(rest.includes('--model') || !cfg.model ? [] : ['--model', cfg.model]));
}
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
if (Array.isArray(history) && models.length > 1) { console.error('precost: --history como lista vale para UM modelo; para comparar varios use um mapa {"modelo": [sessoes]} (cada linha usa so o seu historico).'); process.exit(2); }
const res = estimate({ task, fileTexts: (values.file ?? []).map((f) => readFileSync(f, 'utf8')), models, prices, history, cacheHit: Number(values['cache-hit'] ?? 0), date: values.date });
console.log(values.json ? JSON.stringify(res, null, 2) : format(res));
