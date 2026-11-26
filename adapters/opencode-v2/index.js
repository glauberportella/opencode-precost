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
import { readContextFile } from '../../src/context.js';
import { fileURLToPath } from 'node:url';
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
      const root = opts.root ?? process.cwd();
      const approvedModel = new Map(); // sessionID -> {id, providerID} do modelo que o gate estimou
      const modelOf = (m) => (m ? { id: m.id ?? m.modelID, providerID: m.providerID } : undefined);
      const sameModel = (a, b) => a && b && a.id === b.id && (!a.providerID || !b.providerID || a.providerID === b.providerID);
      await ctx.session.hook('prompt', async (event) => {
        try {
          const text = event.prompt?.text ?? '';
          const files = [];
          for (const f of event.prompt?.files ?? []) { // anexos: arquivo legivel dentro do projeto e contado; o resto nao e contado e o gate avisa/bloqueia
            const label = f.name ?? f.uri;
            if (typeof f.uri === 'string' && f.uri.startsWith('file:')) { try { files.push(readContextFile(fileURLToPath(f.uri), root)); } catch { files.push({ path: label, skipped: tr('invalid url', 'url invalida') }); } }
            else files.push({ path: label, skipped: tr('attachment is not a local file (inline or remote), not counted', 'anexo nao e arquivo local (inline ou remoto), nao contado') });
          }
          let model, mref;
          try { const sess = await ctx.session.get({ sessionID: event.sessionID }); mref = modelOf(sess?.model ?? sess?.data?.model); model = mref?.id; } catch { /* sessao ainda nao existe (primeiro prompt): usa o modelo padrao */ }
          if (!model) { try { const d = await ctx.model.default(); model = d?.data?.modelID ?? d?.modelID; mref = { id: model, providerID: d?.data?.providerID ?? d?.providerID }; } catch { /* modelo desconhecido: decide() bloqueia com falha fechada */ } }
          if (isCommand(text)) { // comandos digitados: sempre interceptados (nunca chegam ao modelo), com ou sem limite
            return deny(decide({ prompt: text, model, session: event.sessionID, config: cfg, stateDir: sdir }).text);
          }
          if (!gated) { if (text && opts.log) { /* sem limite: so informa */ } return; }
          const bad = validateConfig(opts);
          if (bad) return deny(tr(`precost: invalid configuration (${bad}). Blocked (fail closed).`, `precost: configuracao invalida (${bad}). Bloqueado (falha fechada).`));
          if (opts.sessionLimitUsd !== undefined && opts.sessionLimitUsd !== null) return deny(tr('precost: sessionLimitUsd is not supported on OpenCode 2.x yet (the real-spend ledger was not ported), so it would be ignored. Blocked (fail closed). Remove sessionLimitUsd and use limitUsd, or stay on OpenCode 1.x.', 'precost: sessionLimitUsd ainda nao e suportado no OpenCode 2.x (o ledger de gasto real nao foi portado), entao seria ignorado. Bloqueado (falha fechada). Remova sessionLimitUsd e use limitUsd, ou fique no OpenCode 1.x.'));
          if (!opts.allowUnverifiedVersion) {
            const v = ctx.app?.version;
            const ok = opts.verifiedVersions ?? VERIFIED_OPENCODE_V2;
            if (!ok.includes(v)) return deny(tr(`precost: OpenCode version ${v ?? 'not identified'} is not in the verified list (${ok.join(', ')}); blocking from the prompt hook is undocumented behavior. Blocked (fail closed). Set allowUnverifiedVersion:true at your own risk.`, `precost: versao do OpenCode ${v ?? 'nao identificada'} fora da lista verificada (${ok.join(', ')}); o bloqueio pelo hook de prompt e comportamento nao documentado. Bloqueado (falha fechada). Use allowUnverifiedVersion:true por sua conta.`));
          }
          if (!text && !files.length) return;
          approvedModel.set(event.sessionID, mref);
          const d = decide({ prompt: text, model, session: event.sessionID, files, config: cfg, stateDir: sdir });
          if (opts.log) opts.log(d.text);
          if (d.action === 'allow') return;
          approvedModel.delete(event.sessionID);
          return deny(d.text);
        } catch (e) {
          if (e?.precostDeny) throw e;
          return deny(tr(`precost: internal error (${e?.message}); blocked for safety (fail closed).`, `precost: erro interno (${e?.message}); bloqueado por seguranca (falha fechada).`));
        }
      });
      if (gated) await ctx.session.hook('context', async (event) => { // pedido real ao modelo: o modelo efetivo tem de ser o que o gate estimou
        const want = approvedModel.get(event.sessionID);
        const got = modelOf(event.model);
        if (!want || !sameModel(want, got)) {
          deny(tr(`precost: the effective model for this request (${got?.providerID ?? '?'}/${got?.id ?? '?'}) is not the one the estimate was made for (${want ? `${want.providerID ?? '?'}/${want.id}` : 'no gated prompt for this session'}). Blocked (fail closed): the estimate would not apply.`, `precost: o modelo efetivo deste pedido (${got?.providerID ?? '?'}/${got?.id ?? '?'}) nao e o da estimativa (${want ? `${want.providerID ?? '?'}/${want.id}` : 'nenhum prompt estimado nesta sessao'}). Bloqueado (falha fechada): a estimativa nao valeria.`));
        }
      });
    },
  };
}
export default precostV2();
