// Atualizacao da tabela de precos de referencia: valida, mostra o diff e so grava com --yes.
// NUNCA roda dentro do hook/plugin (so na CLI). O gate le o arquivo local; falha de rede nao afeta bloqueio.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Sem fonte padrao embutida: uma URL que ainda nao existe falharia em campo. Informe --from ou PRECOST_PRICES_SOURCE.
export const STALE_DAYS = 30;
const NUM_FIELDS = ['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write', 'tokenizer_multiplier'];

export function validatePrices(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return 'tabela nao e um objeto JSON';
  if (t.currency !== 'USD') return 'currency deve ser "USD"';
  if (!t.models || typeof t.models !== 'object' || !Object.keys(t.models).length) return 'models ausente ou vazio';
  for (const [id, m] of Object.entries(t.models)) {
    if (!m || typeof m !== 'object') return `${id}: entrada invalida`;
    for (const f of ['input', 'output']) if (!(typeof m[f] === 'number' && Number.isFinite(m[f]) && m[f] >= 0)) return `${id}: ${f} deve ser numero >= 0`;
    for (const f of NUM_FIELDS) if (m[f] !== undefined && !(typeof m[f] === 'number' && Number.isFinite(m[f]) && m[f] >= 0)) return `${id}: ${f} deve ser numero >= 0 (campo ausente = desconhecido)`;
    if (typeof m.source !== 'string' || !/^https:\/\//.test(m.source)) return `${id}: source (https) obrigatorio`;
    if (typeof m.read !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(m.read)) return `${id}: read (data yyyy-mm-dd) obrigatorio`;
  }
  return null;
}

// Data da tabela = leitura mais recente entre os modelos (yyyy-mm-dd).
export const tableDate = (t) => Object.values(t.models ?? {}).map((m) => String(m.read ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() ?? null;
export const ageDays = (t, now = Date.now()) => { const d = tableDate(t); return d ? Math.max(0, Math.floor((now - Date.parse(d + 'T00:00:00Z')) / 864e5)) : null; };

const CMP = ['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write'];
export function diffPrices(oldT, newT) {
  const changes = [], big = [];
  for (const id of Object.keys(oldT.models)) if (!newT.models[id]) changes.push({ id, kind: 'removido' });
  for (const [id, m] of Object.entries(newT.models)) {
    const o = oldT.models[id];
    if (!o) { changes.push({ id, kind: 'novo' }); continue; }
    for (const f of CMP) {
      if (o[f] === m[f]) continue;
      changes.push({ id, kind: 'preco', field: f, from: o[f] ?? null, to: m[f] ?? null });
      if (typeof o[f] === 'number' && typeof m[f] === 'number' && o[f] > 0 && (m[f] / o[f] > 5 || m[f] / o[f] < 0.2)) big.push(`${id}.${f}: ${o[f]} -> ${m[f]}`);
    }
  }
  const removed = changes.filter((c) => c.kind === 'removido').length;
  return { changes, big, removed };
}

export async function fetchSource(source, { fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = 1_000_000 } = {}) {
  let raw;
  if (/^https?:\/\//i.test(source)) {
    const u = new URL(source);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !loopback) throw new Error('fonte remota precisa ser https');
    const r = await fetchImpl(source, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar ${source}`);
    raw = await r.text();
  } else raw = readFileSync(source, 'utf8');
  if (Buffer.byteLength(raw) > maxBytes) throw new Error('tabela grande demais (> 1 MB)');
  let t; try { t = JSON.parse(raw); } catch { throw new Error('fonte nao e JSON valido'); }
  return { raw, table: t };
}

export function writeUserPrices(path, raw) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, raw); renameSync(tmp, path);
}
export function resetUserPrices(path) { if (existsSync(path)) { unlinkSync(path); return true; } return false; }
export const hashOf = (raw) => createHash('sha256').update(raw).digest('hex').slice(0, 16);
