#!/usr/bin/env node
// Hook UserPromptSubmit (contrato lido em https://code.claude.com/docs/en/hooks.md, secoes UserPromptSubmit e JSON output).
// Bloqueio: JSON {"decision":"block","reason":...} com exit 0. suppressOriginalPrompt evita repetir o prompt na mensagem.
// ATENCAO: este evento tambem dispara em prompts automaticos (tarefas agendadas, subagente em segundo plano, mensagem de outra sessao).
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
// Ordem: env PRECOST_MODEL > rastreador (SessionStart/PostModelSwitch, se trouxerem) > ultima resposta no transcript > ANTHROPIC_MODEL > config.model.
// OBSERVADO no Claude Code 2.1.332: SessionStart e UserPromptSubmit NAO trazem o modelo. Na 1a mensagem de uma sessao so ha ANTHROPIC_MODEL/config.
let modelSource = process.env.PRECOST_MODEL ? 'env PRECOST_MODEL' : model ? 'rastreador' : null;
if (!model && ev.transcript_path) { const { lastModel } = await import('../../src/claude-transcript.js'); model = lastModel(ev.transcript_path) ?? undefined; if (model) modelSource = 'transcript (ultima resposta)'; }
if (!model && process.env.ANTHROPIC_MODEL) { model = process.env.ANTHROPIC_MODEL; modelSource = 'ANTHROPIC_MODEL'; }
if (!model && config.model) { model = config.model; modelSource = 'config.model (pode divergir do modelo real se voce trocou de modelo)'; }

let d;
try {
  const { decide } = await import('../../src/gate.js'); // import dinamico: falha de carga vira falha FECHADA (com limite), nao saida nao-bloqueante
  const { filesFromPrompt } = await import('../../src/context.js');
  const root = ev.cwd ?? process.cwd();
  const { dirname } = await import('node:path'); const { loadPrices } = await import('../../src/pricing.js');
  let history; // historico REAL do projeto e do modelo ativo (transcripts), so se houver 5+ sessoes
  if (model && ev.transcript_path) { const { historyFromDir } = await import('../../src/claude-transcript.js'); const h = historyFromDir(dirname(ev.transcript_path), { model, prices: loadPrices(config.prices), excludeSession: ev.session_id }); if (h.length) history = { [model]: h }; }
  d = decide({ prompt: ev.prompt ?? '', model, session: ev.session_id, config: { systemTokens: 13000, ...config }, stateDir, history, files: filesFromPrompt(ev.prompt ?? '', root) });
  if (modelSource && d.text) d.text += `\nModelo ativo vem de: ${modelSource}.`;
} catch (e) { failure(`erro interno (${e.message})`); }
if (d.action === 'block') block(d.text);
else process.stdout.write(JSON.stringify({ systemMessage: d.text }));
