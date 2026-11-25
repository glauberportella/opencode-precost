import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Acumula tokens reais por sessao a partir de mensagens do assistente concluidas.
// Dedup por id de mensagem (o evento message.updated dispara varias vezes por mensagem).
export class SessionLedger {
  constructor(path) { this.path = path; this.msgs = new Map(); this.sessions = new Map(); this.load(); }
  load() {
    if (!this.path) return;
    try {
      const j = JSON.parse(readFileSync(this.path, 'utf8'));
      for (const s of Array.isArray(j) ? j : j.sessions) this.sessions.set(s.session, s);
      for (const [id, m] of Object.entries(Array.isArray(j) ? {} : j.msgs ?? {})) this.msgs.set(id, m);
    } catch { /* arquivo novo */ }
  }
  record({ id, sessionID, cost, tokens, model, project }) {
    if (this.msgs.has(id)) { // substitui valor anterior da mesma mensagem
      const old = this.msgs.get(id);
      this.apply(old.sessionID ?? sessionID, old, -1);
    }
    const m = { model: model ?? null, project: project ?? null, ctx: (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0), cost: cost ?? 0, input: tokens.input, output: tokens.output + (tokens.reasoning ?? 0), cache_read: tokens.cache?.read ?? 0, cache_write: tokens.cache?.write ?? 0 };
    this.msgs.set(id, { ...m, sessionID });
    this.apply(sessionID, m, 1);
    this.save();
  }
  apply(sessionID, m, sign) {
    const s = this.sessions.get(sessionID) ?? { session: sessionID, turns: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0 };
    s.turns += sign; s.input += sign * m.input; s.output += sign * m.output; s.cache_read += sign * m.cache_read; s.cache_write += sign * m.cache_write; s.cost += sign * m.cost;
    this.sessions.set(sessionID, s);
  }
  spent(sessionID) { return this.sessions.get(sessionID)?.cost ?? 0; }
  // peakCtx = maior contexto REAL (entrada+cache) de uma chamada da sessao, a partir das mensagens registradas.
  list() {
    const peak = new Map(), meta = new Map();
    for (const m of this.msgs.values()) { peak.set(m.sessionID, Math.max(peak.get(m.sessionID) ?? 0, m.ctx ?? 0)); const x = meta.get(m.sessionID) ?? { models: new Set(), projects: new Set() }; x.models.add(m.model); x.projects.add(m.project); meta.set(m.sessionID, x); }
    return [...this.sessions.values()].map((s) => { const x = meta.get(s.session); const one = (set) => (set && set.size === 1 ? [...set][0] : null); return { ...s, ...(peak.get(s.session) > 0 ? { peakCtx: peak.get(s.session) } : {}), model: one(x?.models), project: one(x?.projects) }; });
  }
  save() { if (!this.path) return; mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify({ sessions: this.list(), msgs: Object.fromEntries(this.msgs) }, null, 1)); }
}
