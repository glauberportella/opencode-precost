import { loadPrices } from './pricing.js';
import { tr, setLang } from './i18n.js';
import { userPricesPath } from './paths.js';
import { STALE_DAYS, validatePrices, tableDate, ageDays, diffPrices, fetchSource, writeUserPrices, resetUserPrices } from './prices-update.js';

const usage = () => tr(`usage:
  precost prices                      show which table is in use, its date and age
  precost update-prices --from HTTPS_URL|FILE [--yes] [--force]   (or PRECOST_PRICES_SOURCE)
      without --yes: only shows the diff (nothing is written). --force: accept removals and changes > 5x.
  precost update-prices --reset       remove the user table (back to the bundled one)`, `uso:
  precost prices                      mostra qual tabela esta em uso, data e idade
  precost update-prices --from URL_HTTPS|ARQUIVO [--yes] [--force]   (ou PRECOST_PRICES_SOURCE)
      sem --yes: so mostra o diff (nada e gravado). --force: aceita remocoes e variacoes > 5x.
  precost update-prices --reset       remove a tabela do usuario (volta para a embutida)`);

export async function runPricesCli(cmd, args, { out = console.log, err = console.error } = {}) {
  const o = { from: null, yes: false, force: false, reset: false };
  for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--from') o.from = args[++i]; else if (a === '--yes') o.yes = true; else if (a === '--force') o.force = true; else if (a === '--reset') o.reset = true; else { err(usage()); return 2; } }
  setLang(undefined);
  let cur; try { cur = loadPrices(); } catch (e) { err(tr(`precost: current table unreadable: ${e.message}`, `precost: tabela atual ilegivel: ${e.message}`)); return 1; }
  const ag = ageDays(cur);
  if (cmd === 'prices') {
    out(tr(`table in use: ${cur._source.kind} (${cur._source.path})\ndate: ${tableDate(cur)}${ag === null ? '' : ` (${ag} days)`}; ${Object.keys(cur.models).length} models; hash ${cur._hash}`, `tabela em uso: ${cur._source.kind} (${cur._source.path})\ndata: ${tableDate(cur)}${ag === null ? '' : ` (${ag} dias)`}; ${Object.keys(cur.models).length} modelos; hash ${cur._hash}`));
    if (ag !== null && ag > STALE_DAYS) out(tr(`WARNING: older than ${STALE_DAYS} days. Run \`precost update-prices\`. Prices change; the estimate may be outdated.`, `AVISO: mais de ${STALE_DAYS} dias. Rode \`precost update-prices\`. Precos mudam; a estimativa pode estar defasada.`));
    return 0;
  }
  if (o.reset) { out(resetUserPrices(userPricesPath()) ? tr('user table removed; the bundled one applies again.', 'tabela do usuario removida; volta a valer a embutida.') : tr('there was no user table.', 'nao havia tabela do usuario.')); return 0; }
  const source = o.from ?? process.env.PRECOST_PRICES_SOURCE;
  if (!source) { err(tr('precost: give the table source: --from HTTPS_URL|FILE (or set PRECOST_PRICES_SOURCE). There is no default URL: the project does not publish a table yet. Without a source the current (bundled) table stays in effect; edit data/prices.json from the official price pages or point to your own JSON.', 'precost: informe a fonte da tabela: --from URL_HTTPS|ARQUIVO (ou defina PRECOST_PRICES_SOURCE). Nao ha URL padrao: o projeto ainda nao publica uma tabela. Sem fonte, a tabela atual (embutida) continua valendo; edite data/prices.json a partir das paginas oficiais de preco ou aponte para um JSON seu.')); return 1; }
  let got; try { got = await fetchSource(source); } catch (e) { err(tr(`precost: could not get ${source}: ${e.message}. Current table kept.`, `precost: nao consegui obter ${source}: ${e.message}. Tabela atual mantida.`)); return 1; }
  const bad = validatePrices(got.table); if (bad) { err(tr(`precost: table rejected (${bad}). Current table kept.`, `precost: tabela recusada (${bad}). Tabela atual mantida.`)); return 1; }
  const nd = tableDate(got.table), cd = tableDate(cur);
  if (cd && nd && nd < cd && !o.force) { err(tr(`precost: new table (${nd}) is older than the current one (${cd}). Use --force if intended.`, `precost: tabela nova (${nd}) e mais antiga que a atual (${cd}). Use --force se for proposital.`)); return 1; }
  const d = diffPrices(cur, got.table);
  out(tr(`source: ${source}\ncurrent: ${cd} (${cur._source.kind}) -> new: ${nd}; ${d.changes.length} change(s)`, `fonte: ${source}\natual: ${cd} (${cur._source.kind}) -> nova: ${nd}; ${d.changes.length} alteracao(oes)`));
  for (const c of d.changes) out(c.kind === 'preco' ? `  ${c.id}.${c.field}: ${c.from ?? tr('unknown', 'desconhecido')} -> ${c.to ?? tr('unknown', 'desconhecido')}` : `  ${c.id}: ${tr({ removido: 'removed', novo: 'new' }[c.kind] ?? c.kind, c.kind)}`);
  if ((d.big.length || d.removed) && !o.force) { err(tr(`precost: suspicious changes (${d.removed} removed${d.big.length ? '; change > 5x: ' + d.big.join('; ') : ''}). Check the source and use --force.`, `precost: mudancas suspeitas (${d.removed} removido(s)${d.big.length ? '; variacao > 5x: ' + d.big.join('; ') : ''}). Confira a fonte e use --force.`)); return 1; }
  if (!d.changes.length && nd === cd) { out(tr('already up to date.', 'ja esta atualizada.')); return 0; }
  if (!o.yes) { out(tr('nothing written. To apply: precost update-prices --yes', 'nada gravado. Para aplicar: precost update-prices --yes') + (o.from ? ` --from ${o.from}` : '')); return 0; }
  writeUserPrices(userPricesPath(), got.raw);
  out(tr(`written to ${userPricesPath()}. Pending approvals become invalid (the table is part of the binding). An estimate is still an estimate; check the official source.`, `gravado em ${userPricesPath()}. Aprovacoes pendentes ficam invalidas (a tabela entra no vinculo). Estimativa continua sendo estimativa; confira a fonte oficial.`));
  return 0;
}
