import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { resolveModel } from './pricing.js';

// Transcripts do Claude Code (JSONL; formato OBSERVADO na v2.1.332): linhas type "assistant" com message.{id,model,usage}.
// usage.input_tokens exclui cache; cache_read_input_tokens e cache_creation_input_tokens sao separados.
const MAX_TAIL = 4_000_000, MAX_FILE = 80_000_000, MAX_FILES = 300;
const lines = (text) => text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Modelo da ultima resposta do assistente na sessao (ignora sinteticos). Sem resposta ainda: null.
export function lastModel(transcriptPath) {
  try {
    const size = statSync(transcriptPath).size, n = Math.min(size, MAX_TAIL);
    const fd = openSync(transcriptPath, 'r'); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n); closeSync(fd);
    const ls = lines(buf.toString('utf8')).filter((j) => j.type === 'assistant' && j.message?.model && !String(j.message.model).startsWith('<'));
    return ls.length ? ls[ls.length - 1].message.model : null;
  } catch { return null; }
}

// Historico real do projeto (mesma pasta de transcripts) para UM modelo, excluindo a sessao atual.
export function historyFromDir(dir, { model, prices, excludeSession }) {
  const want = resolveModel(prices, model);
  if (!want) return [];
  const out = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => [f, statSync(join(dir, f))]).filter(([, s]) => s.size <= MAX_FILE).sort((a, b) => b[1].mtimeMs - a[1].mtimeMs).slice(0, MAX_FILES); } catch { return []; }
  for (const [f] of files) {
    if (excludeSession && f.startsWith(excludeSession)) continue;
    const byId = new Map();
    let ls; try { ls = lines(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    for (const j of ls) {
      const m = j.message;
      if (j.type !== 'assistant' || !m?.usage || !m.id) continue;
      if (resolveModel(prices, m.model) !== want) continue;
      const u = m.usage, cur = byId.get(m.id) ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
      byId.set(m.id, { input: Math.max(cur.input, u.input_tokens ?? 0), output: Math.max(cur.output, u.output_tokens ?? 0), cache_read: Math.max(cur.cache_read, u.cache_read_input_tokens ?? 0), cache_write: Math.max(cur.cache_write, u.cache_creation_input_tokens ?? 0) });
    }
    if (!byId.size) continue;
    const s = { input: 0, output: 0, cache_read: 0, cache_write: 0, turns: byId.size, peakCtx: 0 };
    for (const m of byId.values()) { s.input += m.input; s.output += m.output; s.cache_read += m.cache_read; s.cache_write += m.cache_write; s.peakCtx = Math.max(s.peakCtx, m.input + m.cache_read + m.cache_write); }
    out.push(s);
  }
  return out;
}
