#!/usr/bin/env node
// Hook UserPromptSubmit (contrato lido em https://code.claude.com/docs/en/hooks.md, secoes UserPromptSubmit e JSON output).
// Bloqueio: JSON {"decision":"block","reason":...} com exit 0. suppressOriginalPrompt evita repetir o prompt na mensagem.
// ATENCAO: este evento tambem dispara em prompts automaticos (tarefas agendadas, subagente em segundo plano, mensagem de outra sessao).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../src/gate.js';

let ev = {};
try { ev = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const stateDir = process.env.PRECOST_STATE ?? join(homedir(), '.cache', 'precost');
const cfgPath = process.env.PRECOST_CONFIG ?? join(homedir(), '.config', 'precost', 'config.json');
let config = {};
try { config = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { /* sem config: so informativo */ }

// Modelo ativo: o evento nao traz. Vem do rastreador (SessionStart/PostModelSwitch) ou, na falta, de config.model.
let model = process.env.PRECOST_MODEL;
if (!model) { try { model = JSON.parse(readFileSync(join(stateDir, `model-${ev.session_id}.json`), 'utf8')).model; } catch { /* nao rastreado */ } }
model ??= config.model;

let d;
try { d = decide({ prompt: ev.prompt ?? '', model, session: ev.session_id, config, stateDir }); }
catch (e) { // falha do proprio hook: nao trava o usuario, mas avisa
  process.stdout.write(JSON.stringify({ systemMessage: `precost: erro interno (${e.message}); sem previa nem gate neste prompt.` })); process.exit(0);
}
if (d.action === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason: d.text, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } }));
else process.stdout.write(JSON.stringify({ systemMessage: d.text }));
