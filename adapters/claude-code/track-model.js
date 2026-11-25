#!/usr/bin/env node
// Hooks SessionStart (campo model, opcional) e PostModelSwitch (to_model). Guarda o modelo por sessao.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
let ev = {};
try { ev = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const model = ev.hook_event_name === 'PostModelSwitch' ? ev.to_model : ev.model;
if (!model || !ev.session_id) process.exit(0);
const dir = process.env.PRECOST_STATE ?? join(homedir(), '.cache', 'precost');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `model-${ev.session_id}.json`), JSON.stringify({ model, at: Date.now() }));
