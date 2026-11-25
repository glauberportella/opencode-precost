#!/usr/bin/env node
// Hook UserPromptSubmit (contrato lido em https://code.claude.com/docs/en/hooks.md, secoes UserPromptSubmit e JSON output).
// Bloqueio: JSON {"decision":"block","reason":...} com exit 0. suppressOriginalPrompt evita repetir o prompt na mensagem.
// ATENCAO: este evento tambem dispara em prompts automaticos (tarefas agendadas, subagente em segundo plano, mensagem de outra sessao).
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../src/gate.js';
import { filesFromPrompt } from '../../src/context.js';

const block = (text) => { process.stdout.write(JSON.stringify({ decision: 'block', reason: text, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } })); process.exit(0); };
const stateDir = process.env.PRECOST_STATE ?? join(homedir(), '.cache', 'precost');
const cfgPath = process.env.PRECOST_CONFIG ?? join(homedir(), '.config', 'precost', 'config.json');

// Config: ausente = so informativo (e diz isso); presente mas ilegivel/invalida = FALHA FECHADA (bloqueia).
let config = {}, hasCfg = false;
if (existsSync(cfgPath)) {
  hasCfg = true;
  try { config = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch (e) { block(`precost: config ${cfgPath} ilegivel (${e.message}). Bloqueado por seguranca ate corrigir.`); }
}
const gatedCfg = hasCfg && config.limitUsd !== undefined && config.limitUsd !== null;
const failure = (why) => (gatedCfg ? block(`precost: ${why}. Bloqueado por seguranca (falha fechada); nada foi enviado ao modelo.`) : (process.stdout.write(JSON.stringify({ systemMessage: `precost: ${why}; sem previa nem gate neste prompt.` })), process.exit(0)));

let ev;
try { ev = JSON.parse(readFileSync(0, 'utf8')); } catch (e) { failure('entrada do hook ilegivel'); }

// Modelo ativo: o evento nao traz. Vem do rastreador (SessionStart/PostModelSwitch) ou, na falta, de config.model.
let model = process.env.PRECOST_MODEL;
if (!model) { try { model = JSON.parse(readFileSync(join(stateDir, `model-${ev.session_id}.json`), 'utf8')).model; } catch { /* nao rastreado */ } }
model ??= config.model;

let d;
try {
  const root = ev.cwd ?? process.cwd();
  d = decide({ prompt: ev.prompt ?? '', model, session: ev.session_id, config, stateDir, files: filesFromPrompt(ev.prompt ?? '', root) });
} catch (e) { failure(`erro interno (${e.message})`); }
if (d.action === 'block') block(d.text);
else process.stdout.write(JSON.stringify({ systemMessage: d.text }));
