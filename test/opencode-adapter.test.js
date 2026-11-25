import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrecostPlugin } from '../adapters/opencode/index.js';

const mk = async (opt = {}) => PrecostPlugin({}, { historyPath: join(mkdtempSync(join(tmpdir(), 'oc-')), 'h.json'), ...opt });
const asst = (id, cost, input, output) => ({ type: 'message.updated', properties: { info: { id, sessionID: 's1', role: 'assistant', time: { created: 1, completed: 2 }, cost, tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } } } } });

test('tool precost_estimate devolve previa', async () => {
  const p = await mk({ models: ['gemini-4-hydrogen'] });
  const out = await p.tool.precost_estimate.execute({ task: 'adicionar testes' }, {});
  assert.match(String(out.output ?? out), /CONHECIDO/);
});
test('evento acumula gasto real, dedup por id; tool.execute.before bloqueia acima do limite', async () => {
  const p = await mk({ sessionLimitUsd: 1 });
  await p.event({ event: asst('m1', 0.6, 1000, 100) });
  await p.event({ event: asst('m1', 0.6, 1000, 100) }); // repetido
  await p['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c' }, { args: {} }); // 0.6 <= 1 passa
  await p.event({ event: asst('m2', 0.7, 1000, 100) });
  await assert.rejects(p['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c2' }, { args: {} }), /passou do limite/);
});
