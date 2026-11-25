import { loadPrices } from './pricing.js';
import { userPricesPath } from './paths.js';
import { STALE_DAYS, validatePrices, tableDate, ageDays, diffPrices, fetchSource, writeUserPrices, resetUserPrices } from './prices-update.js';

const USAGE = `uso:
  precost prices                      mostra qual tabela esta em uso, data e idade
  precost update-prices --from URL_HTTPS|ARQUIVO [--yes] [--force]   (ou PRECOST_PRICES_SOURCE)
      sem --yes: so mostra o diff (nada e gravado). --force: aceita remocoes e variacoes > 5x.
  precost update-prices --reset       remove a tabela do usuario (volta para a embutida)`;

export async function runPricesCli(cmd, args, { out = console.log, err = console.error } = {}) {
  const o = { from: null, yes: false, force: false, reset: false };
  for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--from') o.from = args[++i]; else if (a === '--yes') o.yes = true; else if (a === '--force') o.force = true; else if (a === '--reset') o.reset = true; else { err(USAGE); return 2; } }
  let cur; try { cur = loadPrices(); } catch (e) { err(`precost: tabela atual ilegivel: ${e.message}`); return 1; }
  const ag = ageDays(cur);
  if (cmd === 'prices') {
    out(`tabela em uso: ${cur._source.kind} (${cur._source.path})\ndata: ${tableDate(cur)}${ag === null ? '' : ` (${ag} dias)`}; ${Object.keys(cur.models).length} modelos; hash ${cur._hash}`);
    if (ag !== null && ag > STALE_DAYS) out(`AVISO: mais de ${STALE_DAYS} dias. Rode \`precost update-prices\`. Precos mudam; a estimativa pode estar defasada.`);
    return 0;
  }
  if (o.reset) { out(resetUserPrices(userPricesPath()) ? 'tabela do usuario removida; volta a valer a embutida.' : 'nao havia tabela do usuario.'); return 0; }
  const source = o.from ?? process.env.PRECOST_PRICES_SOURCE;
  if (!source) { err('precost: informe a fonte da tabela: --from URL_HTTPS|ARQUIVO (ou defina PRECOST_PRICES_SOURCE). Nao ha URL padrao: o projeto ainda nao publica uma tabela. Sem fonte, a tabela atual (embutida) continua valendo; edite data/prices.json a partir das paginas oficiais de preco ou aponte para um JSON seu.'); return 1; }
  let got; try { got = await fetchSource(source); } catch (e) { err(`precost: nao consegui obter ${source}: ${e.message}. Tabela atual mantida.`); return 1; }
  const bad = validatePrices(got.table); if (bad) { err(`precost: tabela recusada (${bad}). Tabela atual mantida.`); return 1; }
  const nd = tableDate(got.table), cd = tableDate(cur);
  if (cd && nd && nd < cd && !o.force) { err(`precost: tabela nova (${nd}) e mais antiga que a atual (${cd}). Use --force se for proposital.`); return 1; }
  const d = diffPrices(cur, got.table);
  out(`fonte: ${source}\natual: ${cd} (${cur._source.kind}) -> nova: ${nd}; ${d.changes.length} alteracao(oes)`);
  for (const c of d.changes) out(c.kind === 'preco' ? `  ${c.id}.${c.field}: ${c.from ?? 'desconhecido'} -> ${c.to ?? 'desconhecido'}` : `  ${c.id}: ${c.kind}`);
  if ((d.big.length || d.removed) && !o.force) { err(`precost: mudancas suspeitas (${d.removed} removido(s)${d.big.length ? '; variacao > 5x: ' + d.big.join('; ') : ''}). Confira a fonte e use --force.`); return 1; }
  if (!d.changes.length && nd === cd) { out('ja esta atualizada.'); return 0; }
  if (!o.yes) { out('nada gravado. Para aplicar: precost update-prices --yes' + (o.from ? ` --from ${o.from}` : '')); return 0; }
  writeUserPrices(userPricesPath(), got.raw);
  out(`gravado em ${userPricesPath()}. Aprovacoes pendentes ficam invalidas (a tabela entra no vinculo). Estimativa continua sendo estimativa; confira a fonte oficial.`);
  return 0;
}
