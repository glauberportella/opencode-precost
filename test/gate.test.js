import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/gate.js';

const cfg = { model: 'gemini-4-neon', limitUsd: 0.5, ttlMin: 10 };
const mk = () => join(mkdtempSync(join(tmpdir(), 'g-')), 'st');
const code = (d) => /precost approve ([0-9a-f]{8})/.exec(d.text)[1];
const T0 = 1_000_000_000_000;

test('aprovacao expira: dentro do ttl vale, depois nao (relogio injetado)', () => {
  for (const [dt, esperado] of [[9 * 60_000, 'allow'], [10 * 60_000 + 1, 'block']]) {
    const st = mk();
    const c = code(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 }));
    decide({ prompt: `precost approve ${c}`, model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 });
    assert.equal(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 + dt }).action, esperado, `dt=${dt}`);
  }
});
test('pendencia expirada nao pode ser aprovada', () => {
  const st = mk();
  const c = code(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 }));
  const r = decide({ prompt: `precost approve ${c}`, model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 + 11 * 60_000 });
  assert.match(r.text, /expirado/);
  assert.equal(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 + 11 * 60_000 }).action, 'block');
});
test('aprovacao vencida e consumida/descartada: nao ressuscita', () => {
  const st = mk();
  const c = code(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 }));
  decide({ prompt: `precost approve ${c}`, model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 });
  assert.equal(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 + 20 * 60_000 }).action, 'block');
  assert.equal(decide({ prompt: 'tarefa', model: cfg.model, session: 's', config: cfg, stateDir: st, now: T0 + 21 * 60_000 }).action, 'block');
});
