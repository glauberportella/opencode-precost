// Plugin OpenCode V2 (opencode 2.x, @opencode/plugin). Porta do gate de prompt do adapter V1.
// Escopo desta porta: o gate (previa, bloqueio acima de limitUsd, 'precost approve CODIGO'). NAO portado: ledger de gasto real por sessao,
// historico por sessao e sessionLimitUsd (V1 usava message.updated e tool.execute.before).
// Mecanismo: ctx.session.hook('prompt', ...) roda uma vez na admissao do prompt, antes da resolucao de modelo. A doc oficial diz que o hook nao
// tem API tipada de rejeicao; lancar erro impede a admissao (verificado em opencode 2.4.2: nenhuma chamada ao provedor), efeito NAO documentado como
// rejeicao, por isso a versao e verificada em runtime e versao fora da lista falha FECHADA (salvo allowUnverifiedVersion).
// O modelo vem da sessao (ctx.session.get). Um agente com modelo proprio pode divergir: o gate usa o modelo da sessao e diz isso.
import { stateDir } from '../../src/paths.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decide, validateConfig, isCommand } from '../../src/gate.js';
import { loadPrices } from '../../src/pricing.js';
import { tr, setLang } from '../../src/i18n.js';

export const VERIFIED_OPENCODE_V2 = ['2.4.2'];

export function precostV2(options = {}) {
  return {
    id: 'opencode-precost',
    async setup(ctx) {
      const opts = { ...(ctx.options ?? {}), ...options };
      setLang(opts.lang);
      const sdir = opts.stateDir ?? stateDir();
      const cfg = { limitUsd: opts.limitUsd, ttlMin: opts.ttlMin, cacheHit: opts.cacheHit, prices: opts.prices, compare: opts.compare, lang: opts.lang };
      const note = (text) => { try { mkdirSync(sdir, { recursive: true }); writeFileSync(join(sdir, 'last-block-v2.txt'), text); } catch { /* melhor esforco */ } if (opts.log) { try { opts.log(text); } catch { /* ignora */ } } };
      const deny = (msg) => { note(msg); const err = new Error(msg); err.precostDeny = true; throw err; };
      const gated = opts.limitUsd !== undefined && opts.limitUsd !== null;
      await ctx.session.hook('prompt', async (event) => {
        try {
          const text = event.prompt?.text ?? '';
          const files = [];
          let model;
          try { model = (await ctx.session.get({ sessionID: event.sessionID }))?.model?.id; } catch { /* sessao ainda nao existe (primeiro prompt): usa o modelo padrao */ }
          if (!model) { try { const d = await ctx.model.default(); model = d?.data?.modelID ?? d?.modelID; } catch { /* modelo desconhecido: decide() bloqueia com falha fechada */ } }
          if (isCommand(text)) { // comandos digitados: sempre interceptados (nunca chegam ao modelo), com ou sem limite
            return deny(decide({ prompt: text, model, session: event.sessionID, config: cfg, stateDir: sdir }).text);
          }
          if (!gated) { if (text && opts.log) { /* sem limite: so informa */ } return; }
          const bad = validateConfig(opts);
          if (bad) return deny(tr(`precost: invalid configuration (${bad}). Blocked (fail closed).`, `precost: configuracao invalida (${bad}). Bloqueado (falha fechada).`));
          if (!opts.allowUnverifiedVersion) {
            const v = ctx.app?.version;
            const ok = opts.verifiedVersions ?? VERIFIED_OPENCODE_V2;
            if (!ok.includes(v)) return deny(tr(`precost: OpenCode version ${v ?? 'not identified'} is not in the verified list (${ok.join(', ')}); blocking from the prompt hook is undocumented behavior. Blocked (fail closed). Set allowUnverifiedVersion:true at your own risk.`, `precost: versao do OpenCode ${v ?? 'nao identificada'} fora da lista verificada (${ok.join(', ')}); o bloqueio pelo hook de prompt e comportamento nao documentado. Bloqueado (falha fechada). Use allowUnverifiedVersion:true por sua conta.`));
          }
          if (!text) return;
          const d = decide({ prompt: text, model, session: event.sessionID, files, config: cfg, stateDir: sdir });
          if (opts.log) opts.log(d.text);
          if (d.action === 'allow') return;
          return deny(d.text);
        } catch (e) {
          if (e?.precostDeny) throw e;
          return deny(tr(`precost: internal error (${e?.message}); blocked for safety (fail closed).`, `precost: erro interno (${e?.message}); bloqueado por seguranca (falha fechada).`));
        }
      });
    },
  };
}
export default precostV2();
