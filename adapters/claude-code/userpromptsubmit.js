#!/usr/bin/env node
// Hook UserPromptSubmit do Claude Code. Le o JSON do evento no stdin.
// Bloqueia (decision:"block") quando o teto da faixa passa do limite; senao mostra a previa ao usuario.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../src/gate.js';

let ev = {};
try { ev = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); } // entrada ilegivel: nao atrapalha o usuario
const cfgPath = process.env.PRECOST_CONFIG ?? join(homedir(), '.config', 'precost', 'config.json');
let config = {};
try { config = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { /* sem config: so informativo */ }
const model = process.env.PRECOST_MODEL ?? config.model; // o evento nao traz modelo ativo garantido; configure
const stateDir = process.env.PRECOST_STATE ?? join(homedir(), '.cache', 'precost');

const d = decide({ prompt: ev.prompt ?? '', model, config, stateDir });
if (d.action === 'block') {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: d.text }));
} else {
  process.stdout.write(JSON.stringify({ systemMessage: d.text }));
}
