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

// Modelo ativo: o evento NAO traz (observado na 2.1.332). Ver src/claude-model.js para fontes comprovadas e nao comprovadas.
let model, modelSource, proven = false, observed = false, declared = [];
if (process.env.PRECOST_MODEL) { model = process.env.PRECOST_MODEL; modelSource = 'env PRECOST_MODEL (declaracao do operador, NAO verificada contra o request: nao forca o modelo do Claude; se ele usar outro, o preco aprovado e o do modelo declarado)'; proven = true; }
if (!model) { try { model = JSON.parse(readFileSync(join(stateDir, `model-${ev.session_id}.json`), 'utf8')).model; if (model) { modelSource = 'rastreador (SessionStart/PostModelSwitch; observado, pode estar defasado)'; observed = true; } } catch { /* nao rastreado */ } }
if (!model && ev.transcript_path) { const { lastModel } = await import('../../src/claude-transcript.js'); model = lastModel(ev.transcript_path) ?? undefined; if (model) { modelSource = 'transcript (ultima resposta; observado, nao garante a proxima apos troca de modelo)'; observed = true; } }
if (!model) { const { modelFromProcessChain } = await import('../../src/claude-model.js'); model = modelFromProcessChain() ?? undefined; if (model) { modelSource = 'flag --model do processo claude (observado no inicio; /model pode ter trocado)'; observed = true; } }
if (!model) {
  const { declaredModels } = await import('../../src/claude-model.js');
  declared = declaredModels({ cwd: ev.cwd, config });
  if (declared.length) { model = declared[0].model; modelSource = declared[0].source; const distinct = new Set(declared.map((x) => x.model)); proven = config.trustConfiguredModel === true && distinct.size === 1; if (distinct.size > 1) modelSource += ` (CONFLITO entre ${[...distinct].join(', ')})`; }
}

// So PRECOST_MODEL e aceito sem pior caso, como DECLARACAO do operador (nao e prova tecnica do modelo efetivo). Fonte observada (tracker/transcript/flag) e a melhor evidencia, mas NAO garante o modelo da proxima resposta (troca de modelo): so conta como comprovada com trustConfiguredModel:true e sem conflito com fontes declaradas.
if (observed) {
  const { declaredModels } = await import('../../src/claude-model.js');
  declared = declaredModels({ cwd: ev.cwd, config }).filter((x) => x.model !== model);
  if (declared.length) modelSource += ` (CONFLITO com ${[...new Set(declared.map((x) => x.model))].join(', ')})`;
  proven = config.trustConfiguredModel === true && declared.length === 0;
  if (ev.transcript_path) { const { pendingModelSwitch } = await import('../../src/claude-transcript.js'); const sw = pendingModelSwitch(ev.transcript_path); if (sw) { proven = false; modelSource += ` (TROCA DE MODELO /model${sw.args ? ' ' + sw.args : ''} registrada no transcript depois da ultima resposta: o modelo atual pode ser outro)`; if (sw.args) declared.push({ model: sw.args, source: '/model do transcript' }); } }
}

let d;
try {
  const { decide } = await import('../../src/gate.js'); // import dinamico: falha de carga vira falha FECHADA (com limite), nao saida nao-bloqueante
  const { filesFromPrompt } = await import('../../src/context.js');
  const root = ev.cwd ?? process.cwd();
  const { dirname } = await import('node:path'); const { loadPrices } = await import('../../src/pricing.js');
  let history; // historico REAL do projeto e do modelo ativo (transcripts), so se houver 5+ sessoes
  if (model && ev.transcript_path) { const { historyFromDir } = await import('../../src/claude-transcript.js'); const h = historyFromDir(dirname(ev.transcript_path), { model, prices: loadPrices(config.prices), excludeSession: ev.session_id }); if (h.length) history = { [model]: h }; }
  const prices0 = loadPrices(config.prices);
  const candidates = !proven && model ? [...new Set([model, ...declared.map((x) => x.model), ...(/^claude/i.test(model) ? Object.keys(prices0.models).filter((k) => k.startsWith('claude-')) : [])])] : [];
  d = decide({ prompt: ev.prompt ?? '', model, session: ev.session_id, config: { systemTokens: 13000, ...config }, stateDir, history, files: filesFromPrompt(ev.prompt ?? '', root), modelProof: model ? { proven, source: modelSource, candidates } : undefined });
  if (modelSource && d.text) d.text += `\nModelo ativo vem de: ${modelSource}.`;
} catch (e) { failure(`erro interno (${e.message})`); }
if (d.action === 'block') block(d.text);
else process.stdout.write(JSON.stringify({ systemMessage: d.text }));
