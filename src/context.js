import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Arquivos observados como parte do contexto de um prompt. So le dentro de `root`, sem seguir links para fora,
// ignora segredos obvios e arquivos grandes. O hash entra no vinculo da aprovacao: mudou o arquivo, a aprovacao cai.
const SECRET = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519)|\.git\/.*|\.ssh\/.*)$/i;
const MAX = 1_000_000;

export function readContextFile(path, root) {
  const sig = (p) => { try { const s = statSync(p); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return 'sem-stat'; } };
  try {
    const rp = realpathSync(resolve(root, path)), rr = realpathSync(root);
    if (rp !== rr && !rp.startsWith(rr + sep)) return { path, skipped: 'fora do projeto' };
    if (SECRET.test(rp.slice(rr.length + 1)) || SECRET.test(basename(rp))) return { path, skipped: 'possivel segredo, nao lido', sha: 'stat:' + sig(rp) };
    const st = statSync(rp);
    if (!st.isFile()) return { path, skipped: 'nao e arquivo' };
    if (st.size > MAX) return { path, skipped: `maior que ${MAX} bytes`, bytes: st.size, sha: 'stat:' + sig(rp) };
    const text = readFileSync(rp, 'utf8');
    return { path, bytes: st.size, text, sha: createHash('sha256').update(text).digest('hex') };
  } catch (e) { return { path, skipped: 'ilegivel' }; }
}

// Claude Code: referencias @caminho no texto do prompt.
export function filesFromPrompt(prompt, root) {
  const out = [], seen = new Set();
  for (const m of prompt.matchAll(/(?:^|\s)@([\w./\-~]+)/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const r = readContextFile(m[1], root);
    if (r.text !== undefined || r.skipped !== 'ilegivel') out.push(r);
  }
  return out;
}
// OpenCode: partes type "file" (url file://...).
export function filesFromParts(parts, root) {
  const out = [];
  for (const p of parts ?? []) {
    if (p.type !== 'file' || !p.url?.startsWith('file:')) continue;
    try { out.push(readContextFile(fileURLToPath(p.url), root)); } catch { out.push({ path: p.filename ?? p.url, skipped: 'url invalida' }); }
  }
  return out;
}
export const contextHash = (files) => createHash('sha256').update(JSON.stringify((files ?? []).map((f) => [f.path, f.sha ?? f.skipped ?? null]))).digest('hex');
