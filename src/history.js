import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Acumula tokens reais por sessao a partir de mensagens do assistente concluidas.
// Dedup por id de mensagem (o evento message.updated dispara varias vezes por mensagem).
export class SessionLedger {
  constructor(path) { this.path = path; this.msgs = new Map(); this.sessions = new Map(); this.load(); }
  load() {
    if (!this.path) return;
    try { for (const s of JSON.parse(readFileSync(this.path, 'utf8'))) this.sessions.set(s.session, s); } catch { /* arquivo novo */ }
  }
  record({ id, sessionID, cost, tokens }) {
    if (this.msgs.has(id)) { // substitui valor anterior da mesma mensagem
      const old = this.msgs.get(id);
      this.apply(sessionID, old, -1);
    }
    const m = { cost: cost ?? 0, input: tokens.input, output: tokens.output + (tokens.reasoning ?? 0), cache_read: tokens.cache?.read ?? 0, cache_write: tokens.cache?.write ?? 0 };
    this.msgs.set(id, m);
    this.apply(sessionID, m, 1);
    this.save();
  }
  apply(sessionID, m, sign) {
    const s = this.sessions.get(sessionID) ?? { session: sessionID, turns: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0 };
    s.turns += sign; s.input += sign * m.input; s.output += sign * m.output; s.cache_read += sign * m.cache_read; s.cache_write += sign * m.cache_write; s.cost += sign * m.cost;
    this.sessions.set(sessionID, s);
  }
  spent(sessionID) { return this.sessions.get(sessionID)?.cost ?? 0; }
  list() { return [...this.sessions.values()]; }
  save() { if (!this.path) return; mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(this.list(), null, 1)); }
}
