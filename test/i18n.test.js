import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/gate.js';
import { setLang, resolveLang } from '../src/i18n.js';
import { PrecostPlugin } from '../adapters/opencode/index.js';

const hook = fileURLToPath(new URL('../adapters/claude-code/userpromptsubmit.js', import.meta.url));
const bin = fileURLToPath(new URL('../bin/precost.js', import.meta.url));
const CFG = { model: 'gemini-4-neon', limitUsd: 0.5, ttlMin: 10 };
const st = () => join(mkdtempSync(join(tmpdir(), 'i18n-')), 'st');
const CODE = /precost approve ([0-9a-f]{8})/;
// Words that only appear in the Portuguese text. English output must contain none of them.
const PT_WORDS = /\b(BLOQUEADO|OBSERVADO|ESTIMATIVA|aprovado|codigo|expirado|revogada|Nada foi|nao|previa|tarefa completa|contexto inicial|faixa alta|tabela|Arquivos de contexto|SEM GATE)\b/i;
const LANGS = ['en', 'pt'];
const D = (lang, p, extra = {}) => decide({ prompt: p, model: CFG.model, session: 's', config: { ...CFG, lang }, stateDir: extra.st, now: extra.now ?? 1e12, files: extra.files });

test('default language is English; lang/PRECOST_LANG select Portuguese', () => {
  const old = process.env.PRECOST_LANG; delete process.env.PRECOST_LANG;
  try {
    assert.equal(resolveLang(undefined), 'en');
    assert.equal(resolveLang('pt'), 'pt'); assert.equal(resolveLang('pt-BR'), 'pt'); assert.equal(resolveLang('fr'), 'en');
    process.env.PRECOST_LANG = 'pt'; assert.equal(resolveLang(undefined), 'pt');
    assert.equal(resolveLang('en'), 'en'); // config beats env
  } finally { if (old === undefined) delete process.env.PRECOST_LANG; else process.env.PRECOST_LANG = old; }
});

test('English gate texts: block, approve, resend, revoke, last, preview, unknown code, config error', () => {
  const s = st();
  const b = D('en', 'refactor everything', { st: s });
  assert.equal(b.action, 'block');
  assert.match(b.text, /BLOCKED:/); assert.match(b.text, /Cost preview \(ESTIMATE; active model: gemini-4-neon\)/);
  assert.match(b.text, /OBSERVED:/); assert.match(b.text, /NOT a cap|NOT a spending cap/);
  assert.match(b.text, /Resending the prompt does NOT approve it/);
  assert.doesNotMatch(b.text, PT_WORDS);
  const code = CODE.exec(b.text)[1];
  const a = D('en', `precost approve ${code}`, { st: s });
  assert.match(a.text, /approved for 10 min, single use/); assert.doesNotMatch(a.text, PT_WORDS);
  const ok = D('en', 'refactor everything', { st: s });
  assert.equal(ok.action, 'allow'); assert.match(ok.text, /approval [0-9a-f]{8} consumed/);
  assert.equal(D('en', 'refactor everything', { st: s }).action, 'block'); // single use
  assert.match(D('en', 'precost approve deadbeef', { st: s }).text, /unknown, expired or already used code/);
  assert.match(D('en', 'precost revoke all', { st: s }).text, /revoked/);
  assert.match(D('en', 'precost last', { st: s }).text, /BLOCKED|no block recorded/);
  const pv = D('en', 'precost estimate fix the login bug', { st: s });
  assert.match(pv.text, /On-demand preview .*Nothing was sent to the model/); assert.doesNotMatch(pv.text, PT_WORDS);
  const bad = decide({ prompt: 'x', model: 'm', session: 's', config: { limitUsd: 'abc', lang: 'en' }, stateDir: s });
  assert.match(bad.text, /invalid configuration \(limitUsd must be a number >= 0/);
  assert.equal(bad.command, 'config');
});

test('expired code and unproven model texts in English', () => {
  const s = st();
  const c = CODE.exec(D('en', 'task', { st: s, now: 1e12 }).text)[1];
  assert.match(D('en', `precost approve ${c}`, { st: s, now: 1e12 + 11 * 60_000 }).text, /code expired/);
  const r = decide({ prompt: 'task', model: 'claude-sonnet-5.5', session: 's', config: { limitUsd: 0.01, lang: 'en' }, stateDir: st(), modelProof: { proven: false, source: 'config', candidates: ['claude-sonnet-5.5', 'claude-opus-4.7'] } });
  assert.match(r.text, /MODEL NOT PROVEN/); assert.doesNotMatch(r.text, PT_WORDS);
});

test('behavior is language independent: same actions, commands, code shape and state for en and pt', () => {
  const seq = (lang) => {
    const s = st(); const out = [];
    const step = (p, extra) => { const d = D(lang, p, { st: s, ...extra }); out.push([d.action, d.command ?? null, d.code ? 'code' : null, d.approved ?? null]); return d; };
    const b = step('refactor everything');
    const c = CODE.exec(b.text)[1];
    step('refactor everything');             // resend does not approve
    step(`precost approve ${c}`);
    step('refactor everything');             // consumed
    step('refactor everything');             // single use
    step('precost approve 00000000');
    step('precost revoke all');
    step('precost estimate hello');
    step('precost last');
    step('small', { files: [{ path: 'a.txt', skipped: 'x' }] });
    return out;
  };
  assert.deepEqual(seq('en'), seq('pt'));
  // the command text itself never changes: same approve/revoke syntax in both languages
  for (const lang of LANGS) assert.match(D(lang, 'big task', { st: st() }).text, /precost approve [0-9a-f]{8}/);
  for (const lang of LANGS) assert.match(D(lang, 'big task', { st: st() }).text, /precost revoke [0-9a-f]{8}/);
});

test('Claude Code hook: English by default, Portuguese with config lang, same block decision', () => {
  const run = (cfg, env = {}) => {
    const d = mkdtempSync(join(tmpdir(), 'i18n-h-')); const c = join(d, 'c.json'); writeFileSync(c, JSON.stringify(cfg));
    const e = { ...process.env, PRECOST_CONFIG: c, PRECOST_STATE: join(d, 'st'), ...env }; delete e.PRECOST_LANG; Object.assign(e, env);
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: 's', prompt: 'refactor everything' }), env: e, encoding: 'utf8' });
    assert.equal(r.status, 0); return JSON.parse(r.stdout);
  };
  const en = run(CFG), pt = run({ ...CFG, lang: 'pt' }), envpt = run(CFG, { PRECOST_LANG: 'pt' });
  for (const o of [en, pt, envpt]) { assert.equal(o.decision, 'block'); assert.match(o.reason, CODE); }
  assert.match(en.reason, /BLOCKED:/); assert.match(en.reason, /Active model comes from|Cost preview/); assert.doesNotMatch(en.reason, PT_WORDS);
  assert.match(pt.reason, /BLOQUEADO:/); assert.match(envpt.reason, /BLOQUEADO:/);
  // fail closed on a broken config, in English
  const d = mkdtempSync(join(tmpdir(), 'i18n-h-')); const c = join(d, 'c.json'); writeFileSync(c, '{broken');
  const e = { ...process.env, PRECOST_CONFIG: c, PRECOST_STATE: join(d, 'st') }; delete e.PRECOST_LANG;
  const r = spawnSync(process.execPath, [hook], { input: '{}', env: e, encoding: 'utf8' });
  const o = JSON.parse(r.stdout); assert.equal(o.decision, 'block'); assert.match(o.reason, /unreadable.*Blocked for safety/);
});

test('OpenCode plugin: English by default and lang option, tool description in English', async () => {
  const mk = (opt) => PrecostPlugin({}, { historyPath: join(mkdtempSync(join(tmpdir(), 'oc-')), 'h.json'), stateDir: st(), allowUnverifiedVersion: true, ...opt });
  const old = process.env.PRECOST_LANG; delete process.env.PRECOST_LANG;
  try {
    const en = await mk({ limitUsd: 0.5, models: ['gemini-4-neon'] });
    const err = await en['chat.message']({ model: { modelID: 'gemini-4-neon' }, sessionID: 's' }, { parts: [{ type: 'text', text: 'refactor everything' }] }).then(() => null, (e) => e);
    assert.ok(err); assert.match(err.message, /BLOCKED:/); assert.match(err.message, CODE); assert.doesNotMatch(err.message, PT_WORDS);
    const est = await en.tool.precost_estimate.execute({ task: 'add tests' }, {}); assert.match(String(est.output ?? est), /OBSERVED/);
    const pt = await mk({ limitUsd: 0.5, lang: 'pt' });
    const e2 = await pt['chat.message']({ model: { modelID: 'gemini-4-neon' }, sessionID: 's' }, { parts: [{ type: 'text', text: 'refactor everything' }] }).then(() => null, (e) => e);
    assert.match(e2.message, /BLOQUEADO:/);
  } finally { if (old !== undefined) process.env.PRECOST_LANG = old; setLang(undefined); }
});

test('CLI: English default for prices/update-prices/estimate/doctor, Portuguese with PRECOST_LANG=pt, same exit codes', () => {
  const d = mkdtempSync(join(tmpdir(), 'i18n-cli-'));
  const env = (lang) => { const e = { ...process.env, PRECOST_CONFIG: join(d, 'cfg', 'config.json'), PRECOST_PRICES: join(d, 'p.json'), PRECOST_STATE: join(d, 'st'), HOME: d, USERPROFILE: d, XDG_CONFIG_HOME: join(d, 'xdg'), APPDATA: join(d, 'appdata'), LOCALAPPDATA: join(d, 'local') }; delete e.PRECOST_LANG; if (lang) e.PRECOST_LANG = lang; return e; };
  const run = (args, lang) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: env(lang) });
  for (const [args, enRe, ptRe] of [
    [['prices'], /table in use: bundled/, /tabela em uso: bundled/],
    [['update-prices'], /give the table source/, /informe a fonte da tabela/],
    [['estimate', 'fix the login bug', '--model', 'claude-sonnet-5.5'], /Cost preview \(ESTIMATE\)/, /Previa de custo \(ESTIMATIVA\)/],
    [['last'], /no block recorded/, /sem bloqueio registrado/],
  ]) {
    const en = run(args), pt = run(args, 'pt');
    assert.equal(en.status, pt.status, args.join(' '));
    assert.match(en.stdout + en.stderr, enRe); assert.doesNotMatch(en.stdout + en.stderr, PT_WORDS);
    assert.match(pt.stdout + pt.stderr, ptRe);
  }
  const doc = run(['doctor', '--project', d]), docPt = run(['doctor', '--project', d], 'pt');
  assert.equal(doc.status, docPt.status);
  assert.match(doc.stdout, /\[(OK|WARN|INFO)\]/); assert.doesNotMatch(doc.stdout, /\[(AVISO|FALHA)\]/);
  assert.match(doc.stdout, /LIMIT: the doctor proves/); assert.match(docPt.stdout, /LIMITE: o doctor prova/);
});
