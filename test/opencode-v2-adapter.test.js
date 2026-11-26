import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { precostV2, VERIFIED_OPENCODE_V2 } from '../adapters/opencode-v2/index.js';
process.env.PRECOST_LANG = 'en';

// Contexto falso minimo do OpenCode V2: captura o hook de prompt e responde session.get / model.default.
async function load({ version = VERIFIED_OPENCODE_V2[0], sessionModel = 'claude-sonnet-5.5', defaultModel, opts = {} } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'oc2-'));
  let hook, chook;
  const ctx = {
    app: { version },
    options: {},
    session: {
      hook: async (name, fn) => { if (name === 'prompt') hook = fn; if (name === 'context') chook = fn; return { dispose() {} }; },
      get: async () => { if (sessionModel === 'throw') throw new Error('no session'); return { model: sessionModel ? { id: sessionModel } : undefined }; },
    },
    model: { default: async () => (defaultModel ? { data: { modelID: defaultModel } } : (() => { throw new Error('no default'); })()) },
  };
  const def = precostV2({ stateDir: join(d, 'st'), ...opts });
  await def.setup(ctx);
  const send = (text, sessionID = 'ses_1') => hook({ sessionID, messageID: 'msg_1', prompt: { text }, metadata: {}, delivery: 'steer' });
  const ctxReq = (model, sessionID = 'ses_1') => chook({ sessionID, model, agent: 'build', system: [], messages: [], options: {}, tools: {} });
  const sendFiles = (text, files, sessionID = 'ses_1') => hook({ sessionID, messageID: 'msg_1', prompt: { text, files }, metadata: {}, delivery: 'steer' });
  return { send, sendFiles, def, ctxReq, hasContextHook: () => !!chook };
}

test('define id e setup; export default carrega sem opcoes', async () => {
  const m = await import('../adapters/opencode-v2/index.js');
  assert.equal(m.default.id, 'opencode-precost');
  assert.equal(typeof m.default.setup, 'function');
});
test('sem limitUsd so informa: o prompt passa', async () => {
  const { send } = await load();
  await send('refactor everything');
});
test('limite alto: passa; limite baixo: lanca bloqueio com codigo de aprovacao', async () => {
  const hi = await load({ opts: { limitUsd: 1000 } });
  await hi.send('hello');
  const lo = await load({ opts: { limitUsd: 0.5 } });
  await assert.rejects(lo.send('refactor the whole module'), /precost approve [0-9a-f]{8}/);
});
test('approve libera uma vez (uso unico) para o mesmo prompt e sessao', async () => {
  const { send } = await load({ opts: { limitUsd: 0.5 } });
  let code;
  await send('refactor the whole module').catch((e) => { code = /precost approve ([0-9a-f]{8})/.exec(e.message)[1]; });
  await assert.rejects(send(`precost approve ${code}`), /approv/i); // comando e interceptado: nunca chega ao modelo
  await send('refactor the whole module');
  await assert.rejects(send('refactor the whole module'), /precost approve/);
});
test('versao do OpenCode fora da lista falha FECHADO, ate prompt barato; allowUnverifiedVersion libera', async () => {
  const bad = await load({ version: '9.9.9', opts: { limitUsd: 1000 } });
  await assert.rejects(bad.send('hello'), /not in the verified list/);
  const none = await load({ version: null, opts: { limitUsd: 1000 } });
  await assert.rejects(none.send('hello'), /not identified/);
  const ok = await load({ version: '9.9.9', opts: { limitUsd: 1000, allowUnverifiedVersion: true } });
  await ok.send('hello');
});
test('modelo: sessao ainda sem modelo usa o padrao; sem nenhum, falha fechado; modelo sem preco bloqueia', async () => {
  const dflt = await load({ sessionModel: 'throw', defaultModel: 'claude-sonnet-5.5', opts: { limitUsd: 1000 } });
  await dflt.send('hello');
  const none = await load({ sessionModel: 'throw', opts: { limitUsd: 1000 } });
  await assert.rejects(none.send('hello'), /unknown/);
  const noprice = await load({ sessionModel: 'modelo-inexistente', opts: { limitUsd: 1000 } });
  await assert.rejects(noprice.send('hello'), /no price/);
});
test('config invalida e erro interno falham fechado', async () => {
  const bad = await load({ opts: { limitUsd: -1 } });
  await assert.rejects(bad.send('hello'), /invalid configuration/);
});

test('sessionLimitUsd configurado nao e ignorado em silencio: falha fechada', async () => {
  const { send } = await load({ opts: { limitUsd: 1000, sessionLimitUsd: 5 } });
  await assert.rejects(send('hi'), /sessionLimitUsd is not supported/);
});
test('anexo nao local (inline/imagem) nao e contado: bloqueia mesmo com limite alto', async () => {
  const d = await load({ opts: { limitUsd: 1000 } });
  const files = [{ uri: 'data:image/png;base64,AAAA', name: 'pic.png' }];
  await assert.rejects(d.sendFiles('see', files), /NOT counted|not counted/i);
});
test('hook de contexto: modelo efetivo igual ao estimado passa; diferente ou sem prompt estimado bloqueia', async () => {
  const d = await load({ opts: { limitUsd: 1000 } });
  await assert.rejects(d.ctxReq({ id: 'claude-sonnet-5.5', providerID: 'x' }), /no gated prompt/);
  await d.send('hello');
  await d.ctxReq({ id: 'claude-sonnet-5.5', providerID: 'x' });
  await assert.rejects(d.ctxReq({ id: 'claude-opus-5', providerID: 'x' }), /not the one the estimate was made for/);
});
test('sem limitUsd nao registra hook de contexto', async () => {
  const d = await load();
  assert.equal(d.hasContextHook(), false);
});
