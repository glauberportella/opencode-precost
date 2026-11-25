import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { estimate, range } from './estimate.js';
import { format } from './format.js';
import { loadPrices } from './pricing.js';
import { contextHash } from './context.js';

// Aprovacao explicita e vinculada. Reenviar o mesmo prompt NUNCA aprova.
// Fluxo: (1) prompt que nao cabe no limite (ou nao pode ser avaliado) -> bloqueia, cria pendencia com CODIGO aleatorio;
//        (2) o usuario digita "precost approve CODIGO" -> aprovacao vinculada a prompt, modelo, sessao, tabela de precos,
//            limite, faixa alta estimada e arquivos de contexto (hash do conteudo); vale por ttl, uso unico;
//        (3) reenviar o prompt original consome a aprovacao se o vinculo ainda bate.
// Revogar: "precost revoke CODIGO" ou "precost revoke all": remove pendencias E aprovacoes ja concedidas.
// LIMITE DE SEGURANCA (declarado): o estado fica em arquivos do mesmo usuario. Um agente com shell/escrita nesse usuario pode
// forjar aprovacao. O gate protege contra gasto acidental e prompts grandes, NAO contra um agente que queira se autoaprovar.
const APPROVE = /^\s*precost\s+approve\s+([0-9a-f]{8})\s*$/i;
const PREVIEW = /^\s*precost\s+(?:estimate|preview)\s+([\s\S]+)$/i;
const LAST = /^\s*precost\s+last\s*$/i;
const REVOKE = /^\s*precost\s+revoke\s+([0-9a-f]{8}|all)\s*$/i;

export const isCommand = (p) => LAST.test(p) || PREVIEW.test(p) || REVOKE.test(p) || APPROVE.test(p);
const lastFile = (session) => `last-block-${createHash('sha256').update(String(session ?? 'global')).digest('hex').slice(0, 12)}.txt`;

export function bindingHash({ prompt, model, session, pricesHash, limit, maxUsd, ctx = '' }) {
  const max = Number.isFinite(maxUsd) ? Math.round(maxUsd * 1e6) : 'sem-limite-conhecido';
  return createHash('sha256').update(JSON.stringify([prompt, model ?? null, session ?? null, pricesHash, limit, max, ctx])).digest('hex');
}
const rd = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const alive = (r, now) => r && now <= r.expiresAt;
const blockCfg = (why) => ({ action: 'block', command: 'config', text: `precost: configuracao invalida (${why}). Bloqueado por seguranca (falha fechada) ate corrigir a configuracao. Nada foi enviado ao modelo.` });

export function validateConfig(config = {}) {
  if (config.limitUsd !== undefined && config.limitUsd !== null && !(typeof config.limitUsd === 'number' && Number.isFinite(config.limitUsd) && config.limitUsd >= 0)) return `limitUsd deve ser numero >= 0, recebido ${JSON.stringify(config.limitUsd)}`;
  if (config.ttlMin !== undefined && !(typeof config.ttlMin === 'number' && Number.isFinite(config.ttlMin) && config.ttlMin > 0)) return `ttlMin deve ser numero > 0, recebido ${JSON.stringify(config.ttlMin)}`;
  if (config.systemTokens !== undefined && !(typeof config.systemTokens === 'number' && Number.isFinite(config.systemTokens) && config.systemTokens >= 0)) return 'systemTokens deve ser numero >= 0';
  if (config.trustConfiguredModel !== undefined && typeof config.trustConfiguredModel !== 'boolean') return 'trustConfiguredModel deve ser true ou false';
  if (config.cacheHit !== undefined && !(typeof config.cacheHit === 'number' && config.cacheHit >= 0 && config.cacheHit <= 1)) return 'cacheHit deve estar entre 0 e 1';
  return null;
}

export function decide({ prompt, model, session, config = {}, stateDir, now = Date.now(), history, files = [], modelProof }) {
  mkdirSync(stateDir, { recursive: true });
  const bad = validateConfig(config);
  if (bad) return blockCfg(bad);
  const ttl = (config.ttlMin ?? 10) * 60_000;

  let m;
  if (LAST.test(prompt)) {
    let t = 'precost: sem bloqueio registrado nesta sessao.'; try { t = readFileSync(join(stateDir, lastFile(session)), 'utf8'); } catch { /* nenhum */ }
    return { action: 'block', text: t, command: 'last' };
  }
  if ((m = PREVIEW.exec(prompt))) { // previa sob demanda: digitada pelo usuario, nunca chega ao modelo, sem gasto
    let prices0; try { prices0 = loadPrices(config.prices); } catch (e) { return blockCfg(`tabela de precos ilegivel: ${e.message}`); }
    const r0 = estimate({ systemTokens: config.systemTokens, task: m[1], models: [model, ...(config.compare ?? [])].filter(Boolean).length ? [model, ...(config.compare ?? [])].filter(Boolean) : Object.keys(prices0.models), prices: prices0, history, cacheHit: config.cacheHit ?? 0 });
    return { action: 'block', command: 'preview', text: format(r0, { title: `Previa sob demanda (ESTIMATIVA; modelo ativo: ${model ?? 'desconhecido'}). Nada foi enviado ao modelo.` }) };
  }
  if ((m = REVOKE.exec(prompt))) {
    const want = m[1].toLowerCase();
    let n = 0;
    for (const f of readdirSync(stateDir)) {
      if (!/^(pending|approved)-.*\.json$/.test(f)) continue;
      const r = rd(join(stateDir, f));
      if (want === 'all' || !r || r.code === want) { unlinkSync(join(stateDir, f)); n++; }
    }
    return { action: 'block', text: `precost: ${n} pendencia(s)/aprovacao(oes) revogada(s).`, command: 'revoke', revoked: n };
  }
  if ((m = APPROVE.exec(prompt))) {
    const code = m[1].toLowerCase();
    const pf = join(stateDir, `pending-${code}.json`);
    const p = existsSync(pf) ? rd(pf) : null;
    if (!p) return { action: 'block', text: 'precost: codigo desconhecido, expirado ou ja usado. Nada foi aprovado.', command: 'approve' };
    if (!alive(p, now)) { unlinkSync(pf); return { action: 'block', text: 'precost: codigo expirado. Nada foi aprovado; reenvie o prompt para gerar outro.', command: 'approve' }; }
    if (p.session !== (session ?? null)) return { action: 'block', text: 'precost: codigo pertence a outra sessao. Nada foi aprovado.', command: 'approve' };
    writeFileSync(join(stateDir, `approved-${code}.json`), JSON.stringify({ binding: p.binding, code, expiresAt: now + ttl }));
    unlinkSync(pf);
    return { action: 'block', text: `precost: aprovado por ${config.ttlMin ?? 10} min, uso unico. Agora reenvie o prompt original sem alteracao. Para desfazer: precost revoke ${code}`, command: 'approve' };
  }

  let prices;
  try { prices = loadPrices(config.prices); } catch (e) { return blockCfg(`tabela de precos ilegivel: ${e.message}`); }
  const limit = config.limitUsd;
  const gated = typeof limit === 'number';
  const unproven = modelProof && modelProof.proven === false && modelProof.candidates?.length > 1;
  const models = [...new Set([model, ...(unproven ? modelProof.candidates : []), ...(config.compare ?? [])].filter(Boolean))];
  const res = estimate({ systemTokens: config.systemTokens, task: prompt, fileTexts: files.filter((f) => f.text !== undefined).map((f) => f.text), models: models.length ? models : Object.keys(prices.models), prices, history, cacheHit: config.cacheHit ?? 0 });
  const active = model ? res.rows.find((r) => r.model === model && !r.error) : null;
  const skipped = files.filter((f) => f.skipped);
  let text = format(res, { title: `Previa de custo (ESTIMATIVA; modelo ativo: ${model ?? 'desconhecido'})` });
  if (files.length) text += `\nArquivos de contexto: ${files.map((f) => f.skipped ? `${f.path} (NAO contado: ${f.skipped})` : `${f.path} (${f.bytes} bytes)`).join(', ')}.`;
  if (!gated) return { action: 'allow', text: text + '\nSEM GATE: limitUsd nao configurado; apenas informativo.', res, ungated: true };

  // O gate decide se precisa de aprovacao: faixa alta acima do limite, modelo sem preco, ou custo so com limite inferior.
  let reason = null, maxUsd = null, bindModel = model;
  if (!active) reason = `modelo ativo ${model ? `"${model}" sem preco na tabela` : 'desconhecido'}: custo nao pode ser avaliado`;
  else {
    maxUsd = range(active).max;
    if (active.lowerBound) { reason = 'contexto acima do limiar sem taxa conhecida: o valor mostrado e so limite inferior'; maxUsd = Infinity; }
    if (unproven) { // modelo efetivo nao comprovado: o gate usa o PIOR CASO entre os candidatos e diz isso
      const rows = res.rows.filter((r) => modelProof.candidates.includes(r.model) && !r.error);
      const worst = rows.map((r) => ({ r, v: r.lowerBound ? Infinity : range(r).max })).sort((a, b) => b.v - a.v)[0];
      const mine = maxUsd;
      maxUsd = worst.v; bindModel = `${model}|nao-comprovado:${modelProof.source}|pior:${worst.r.model}`;
      text += `\nMODELO NAO COMPROVADO (fonte: ${modelProof.source}). O gate usa o PIOR CASO entre ${rows.length} modelos candidatos: ${worst.r.model} ${Number.isFinite(worst.v) ? 'US$' + worst.v.toFixed(2) : 'sem limite superior conhecido'}; com ${model} a faixa alta seria ${Number.isFinite(mine) ? 'US$' + mine.toFixed(2) : 'indefinida'}. Para usar o preco do modelo declarado, informe o modelo (PRECOST_MODEL ou claude --model) ou declare trustConfiguredModel:true no config.`;
      if (maxUsd > limit) reason = `modelo efetivo nao comprovado e o pior caso (${worst.r.model}) passa do limite US$${limit}`;
    } else if (!active.lowerBound && maxUsd > limit) reason = `faixa alta estimada US$${maxUsd.toFixed(2)} acima do limite US$${limit} (faixa alta = P75/cenario grande, NAO e teto de gasto)`;
  }
  if (!reason && skipped.length === 0) return { action: 'allow', text, res };
  if (!reason) reason = `arquivos de contexto nao contados (${skipped.map((f) => f.path).join(', ')}): custo pode estar subestimado`;

  const binding = bindingHash({ prompt, model: bindModel, session, pricesHash: prices._hash, limit, maxUsd, ctx: contextHash(files) });
  for (const f of readdirSync(stateDir)) {
    if (!/^approved-[0-9a-f]{8}\.json$/.test(f)) continue;
    const a = rd(join(stateDir, f));
    if (a && a.binding === binding) {
      unlinkSync(join(stateDir, f)); // uso unico, mesmo expirado
      if (alive(a, now)) return { action: 'allow', text: text + `\n(aprovacao ${a.code} consumida)`, res, approved: true };
    }
  }
  const code = randomBytes(4).toString('hex');
  writeFileSync(join(stateDir, `pending-${code}.json`), JSON.stringify({ binding, code, session: session ?? null, expiresAt: now + ttl }));
  const out = text + `\n\nBLOQUEADO: ${reason}. Reenviar o prompt NAO aprova. Para aprovar este prompt, neste modelo, com estes precos e estes arquivos, digite exatamente: precost approve ${code} (vale ${config.ttlMin ?? 10} min, uso unico; desfaz com precost revoke ${code}). Depois reenvie o prompt sem alteracao. Isto nao limita o gasto durante a tarefa.`;
  writeFileSync(join(stateDir, lastFile(session)), out);
  return { action: 'block', code, text: out, res };
}
