import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { estimate, range } from './estimate.js';
import { format } from './format.js';
import { loadPrices } from './pricing.js';

// Aprovacao explicita e vinculada. Reenviar o mesmo prompt NUNCA aprova.
// Fluxo: (1) prompt acima do limite -> bloqueia e cria pendencia com CODIGO aleatorio;
//        (2) o usuario digita "precost approve CODIGO" -> aprovacao vinculada (prompt, modelo, sessao, tabela de precos,
//            limite, teto da faixa), valida por ttl, uso unico;
//        (3) reenviar o prompt original consome a aprovacao se o vinculo ainda bate; qualquer mudanca invalida.
// Revogar: "precost revoke CODIGO" ou "precost revoke all".
const APPROVE = /^\s*precost\s+approve\s+([0-9a-f]{8})\s*$/i;
const REVOKE = /^\s*precost\s+revoke\s+([0-9a-f]{8}|all)\s*$/i;

export function bindingHash({ prompt, model, session, pricesHash, limit, maxUsd }) {
  return createHash('sha256').update(JSON.stringify([prompt, model, session ?? null, pricesHash, limit, Math.round(maxUsd * 1e6)])).digest('hex');
}
const rd = (f) => JSON.parse(readFileSync(f, 'utf8'));
const alive = (r, now) => r && now <= r.expiresAt;

export function decide({ prompt, model, session, config = {}, stateDir, now = Date.now(), history }) {
  mkdirSync(stateDir, { recursive: true });
  const ttl = (config.ttlMin ?? 10) * 60_000;

  // --- comandos de aprovacao/revogacao (digitados pelo usuario) ---
  let m;
  if ((m = REVOKE.exec(prompt))) {
    let n = 0;
    for (const f of readdirSync(stateDir)) {
      if (!/^(pending|approved)-/.test(f)) continue;
      if (m[1].toLowerCase() === 'all' || f.includes(m[1].toLowerCase())) { unlinkSync(join(stateDir, f)); n++; }
    }
    return { action: 'block', text: `precost: ${n} pendencia(s)/aprovacao(oes) revogada(s).`, command: 'revoke' };
  }
  if ((m = APPROVE.exec(prompt))) {
    const code = m[1].toLowerCase();
    const pf = join(stateDir, `pending-${code}.json`);
    if (!existsSync(pf)) return { action: 'block', text: 'precost: codigo desconhecido, expirado ou ja usado. Nada foi aprovado.', command: 'approve' };
    const p = rd(pf);
    if (!alive(p, now)) { unlinkSync(pf); return { action: 'block', text: 'precost: codigo expirado. Nada foi aprovado; reenvie o prompt para gerar outro.', command: 'approve' };
    }
    if (p.session !== (session ?? null)) return { action: 'block', text: 'precost: codigo pertence a outra sessao. Nada foi aprovado.', command: 'approve' };
    writeFileSync(join(stateDir, `approved-${p.binding.slice(0, 16)}.json`), JSON.stringify({ binding: p.binding, code, expiresAt: now + ttl }));
    unlinkSync(pf);
    return { action: 'block', text: `precost: aprovado por ${config.ttlMin ?? 10} min, uso unico. Agora reenvie o prompt original sem alteracao.`, command: 'approve' };
  }

  const prices = loadPrices(config.prices);
  const models = [model, ...(config.compare ?? [])].filter(Boolean);
  const res = estimate({ task: prompt, models: models.length ? models : Object.keys(prices.models), prices, history, cacheHit: config.cacheHit ?? 0 });
  const active = model ? res.rows.find((r) => r.model === model && !r.error) : null;
  const text = format(res, { title: `Previa de custo (ESTIMATIVA; modelo ativo: ${model ?? 'desconhecido'})` });
  const limit = config.limitUsd;
  if (typeof limit !== 'number') return { action: 'allow', text, res };
  if (!active) return { action: 'allow', text: text + '\nSEM GATE: modelo ativo desconhecido ou sem preco; informativo apenas.', res, ungated: true };
  const maxUsd = range(active).max;
  if (maxUsd <= limit) return { action: 'allow', text, res };

  const binding = bindingHash({ prompt, model, session, pricesHash: prices._hash, limit, maxUsd });
  const af = join(stateDir, `approved-${binding.slice(0, 16)}.json`);
  if (existsSync(af)) {
    const a = rd(af);
    unlinkSync(af); // uso unico, mesmo expirado
    if (a.binding === binding && alive(a, now)) return { action: 'allow', text: text + `\n(aprovacao ${a.code} consumida)`, res, approved: true };
  }
  const code = randomBytes(4).toString('hex');
  writeFileSync(join(stateDir, `pending-${code}.json`), JSON.stringify({ binding, session: session ?? null, expiresAt: now + ttl }));
  return { action: 'block', code, text: text + `\n\nBLOQUEADO: teto estimado ${maxUsd.toFixed(2)} acima do limite US$${limit}. Reenviar o prompt NAO aprova. Para aprovar este prompt, neste modelo e com estes precos, digite exatamente: precost approve ${code} (vale ${config.ttlMin ?? 10} min, uso unico). Depois reenvie o prompt sem alteracao.`, res };
}
