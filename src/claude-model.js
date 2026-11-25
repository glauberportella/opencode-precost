import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Modelo ativo do Claude Code. O evento do hook NAO traz modelo (observado na 2.1.332), entao a comprovacao vem de fontes indiretas.
// ACEITA SEM PIOR CASO: PRECOST_MODEL (declaracao do operador, nao prova tecnica), rastreador, ultima resposta no transcript, flag --model do processo claude (Linux, /proc).
// NAO COMPROVADAS (padroes declarados): ANTHROPIC_MODEL, "model" nos settings do Claude, config.model do precost. O usuario pode ter trocado
// de modelo ou o Claude pode usar outro padrao. Com `trustConfiguredModel: true` no config o usuario declara que estas fontes valem.
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
  const dirs = [env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')];
  for (const f of [join(dirs[0], 'settings.json'), cwd && join(cwd, '.claude', 'settings.json'), cwd && join(cwd, '.claude', 'settings.local.json')].filter(Boolean)) {
    const s = rj(f); if (!s) continue;
    if (s.model) out.push({ model: s.model, source: `settings do Claude (${f})` });
    if (s.env?.ANTHROPIC_MODEL) out.push({ model: s.env.ANTHROPIC_MODEL, source: `settings do Claude env (${f})` });
  }
  if (config.model) out.push({ model: config.model, source: 'config.model do precost' });
  return out;
}
