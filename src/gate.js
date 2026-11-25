import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { estimate, range } from './estimate.js';
import { format } from './format.js';
import { loadPrices } from './pricing.js';

// Politica: se o teto da faixa do modelo ativo passar do limite, o prompt exige confirmacao.
// Confirmar = reenviar o MESMO prompt dentro de ttlMin (estado em stateDir).
export function decide({ prompt, model, config = {}, stateDir, now = Date.now(), history }) {
  const prices = loadPrices(config.prices);
  const models = [model, ...(config.compare ?? [])].filter(Boolean);
  const res = estimate({ task: prompt, models: models.length ? models : Object.keys(prices.models), prices, history, cacheHit: config.cacheHit ?? 0 });
  const active = res.rows.find((r) => r.model === model && !r.error);
  const text = format(res, { title: `Previa de custo (modelo ativo: ${model ?? 'n/d'})` });
  const limit = config.limitUsd;
  if (!active) return { action: 'allow', text: text + '\n(modelo ativo sem preco na tabela: sem gate, apenas informativo)', res };
  if (typeof limit !== 'number' || range(active).max <= limit) return { action: 'allow', text, res };

  const key = createHash('sha256').update(model + '\n' + prompt).digest('hex').slice(0, 24);
  mkdirSync(stateDir, { recursive: true });
  const f = join(stateDir, key + '.json');
  const ttl = (config.ttlMin ?? 10) * 60_000;
  if (existsSync(f)) {
    const t = JSON.parse(readFileSync(f, 'utf8')).at;
    if (now - t <= ttl) return { action: 'allow', text: text + '\n(aprovado: mesmo prompt reenviado)', res, approved: true };
  }
  writeFileSync(f, JSON.stringify({ at: now }));
  return { action: 'block', text: text + `\n\nTeto da faixa acima do limite de US$${limit}. Reenvie o MESMO prompt em ate ${config.ttlMin ?? 10} min para aprovar.`, res };
}
