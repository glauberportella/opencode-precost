#!/usr/bin/env node
// Hooks SessionStart (campo model, opcional) e PostModelSwitch (to_model). Guarda o modelo por sessao.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { stateDir, safeId } from '../../src/paths.js';
import { join } from 'node:path';
let ev = {};
try { ev = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const model = ev.hook_event_name === 'PostModelSwitch' ? ev.to_model : ev.model;
if (!model || !ev.session_id) process.exit(0);
const dir = stateDir();
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `model-${safeId(ev.session_id)}.json`), JSON.stringify({ model, at: Date.now() }));
