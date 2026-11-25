import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeConfigDir } from './paths.js';
import { tr } from './i18n.js';

// Modelo ativo do Claude Code. O evento do hook NAO traz modelo (observado na 2.1.332), entao a resolucao vem de fontes indiretas.
// Nenhuma e prova tecnica do modelo do PROXIMO prompt. PRECOST_MODEL e declaracao do operador (aceita sem pior caso; nao forca o request).
// OBSERVADAS (rastreador, ultima resposta no transcript, flag --model do processo, Linux /proc): so valem com trustConfiguredModel:true e sem /model pendente.
// DECLARADAS (ANTHROPIC_MODEL, "model" nos settings do Claude, config.model): idem. Sem isso o gate usa o pior caso do catalogo suportado.
const rj = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function modelFromProcessChain(startPid = process.ppid, depth = 8) {
  let pid = startPid;
  for (let i = 0; i < depth && pid > 1; i++) {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const k = args.findIndex((a) => a === '--model' || a.startsWith('--model='));
      if (k >= 0 && /claude/i.test(args.join(' '))) return args[k].includes('=') ? args[k].split('=')[1] : args[k + 1];
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch { return null; }
  }
  return null;
}

export function declaredModels({ cwd, env = process.env, config = {} }) {
  const out = [];
  if (env.ANTHROPIC_MODEL) out.push({ model: env.ANTHROPIC_MODEL, source: 'ANTHROPIC_MODEL' });
  const dirs = [claudeConfigDir(env)];
  for (const f of [join(dirs[0], 'settings.json'), cwd && join(cwd, '.claude', 'settings.json'), cwd && join(cwd, '.claude', 'settings.local.json')].filter(Boolean)) {
    const s = rj(f); if (!s) continue;
    if (s.model) out.push({ model: s.model, source: tr(`Claude settings (${f})`, `settings do Claude (${f})`) });
    if (s.env?.ANTHROPIC_MODEL) out.push({ model: s.env.ANTHROPIC_MODEL, source: tr(`Claude settings env (${f})`, `settings do Claude env (${f})`) });
  }
  if (config.model) out.push({ model: config.model, source: tr('precost config.model', 'config.model do precost') });
  return out;
}
