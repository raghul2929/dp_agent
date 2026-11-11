// Tests for skills/dp-security/ledger.mjs. Run from the plugin root: node --test tests/ledger.test.mjs
// Every project here is built in a temp dir, so nothing depends on a real repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../skills/dp-security/ledger.mjs';

const LEDGER_PATH = fileURLToPath(new URL('../skills/dp-security/ledger.mjs', import.meta.url));

// ------------------------------------------------------------------ helpers

function put(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// A small hybrid project: web UI, plain API, an assistant with a backend AND an ai layer,
// a shared library the API and assistant depend on, and ops files.
const HYBRID = {
  'apps/web/src/App.tsx': 'export const App = () => null;\n',
  'apps/web/package.json': '{"name":"web","dependencies":{"react":"18.2.0"}}\n',
  'apps/web/package-lock.json': '{"lockfileVersion":3}\n',
  'services/api/app/main.py': 'def handler():\n    return 1\n',
  'services/api/requirements.txt': 'fastapi==0.110.0\n',
  'services/assistant/app/api.py': 'def ask():\n    return 2\n',
  'services/assistant/llm/answer.py': 'def answer(page):\n    return render_html(page)\n',
  'services/assistant/prompts/system.txt': 'You are a helpful assistant.\n',
  'packages/shared/index.ts': 'export const add = (a: number, b: number) => a + b;\n',
  'infra/Dockerfile': 'FROM node:22\n',
  '.github/workflows/ci.yml': 'name: ci\n',
  'README.md': '# demo\n',
};

const REGISTRY = {
  schema: 1,
  modules: {
    'web-ui': { layers: { frontend: ['apps/web/**'] } },
    api: { layers: { backend: ['services/api/**'] }, depends_on: ['shared-lib'] },
    assistant: {
      layers: { backend: ['services/assistant/app/**'], ai: ['services/assistant/llm/**', 'services/assistant/prompts/**'] },
      depends_on: ['shared-lib'],
    },
    'shared-lib': { layers: { backend: ['packages/shared/**'] } },
    ops: { layers: { infra: ['infra/**', '.github/**'] } },
  },
};

function makeProject(files = HYBRID, registry = REGISTRY) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-'));
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  if (registry) put(root, 'reviews/.ledger/registry.json', JSON.stringify(registry, null, 2));
  return root;
}

const ctxOf = (root, now) => L.loadContext(root, { now, ruleset: 'T1' });
const planOf = (root, o = {}) => {
  const c = ctxOf(root, o.now);
  return L.buildPlan(c, L.evaluate(c), o);
};
const statusOf = (root, o = {}) => {
  const c = ctxOf(root, o.now);
  return L.buildStatus(c, L.evaluate(c), o);
};
const ids = (list) => list.map((x) => x.id);
const rec = (root, id, input = {}, o = {}, now) => L.recordCell(ctxOf(root, now), id, input, o);

function recordAll(root, now) {
  for (const c of L.evaluate(ctxOf(root, now)).cells) rec(root, c.id, {}, {}, now);
}

const F = (o = {}) => ({
  id: 'F-1', severity: 'High', title: 'Crawled page text reaches an HTML sink',
  file: 'services/assistant/llm/answer.py', line: 2,
  scenario: 'Page text containing a script tag flows through answer() into render_html() unescaped.', ...o,
});

// ------------------------------------------------------------------ globs

test('globs: ** crosses directories, * does not, plain paths match as prefixes', () => {
  const m = L.matcher(['services/api/**', '**/*.py', 'infra']);
  assert.ok(m('services/api/app/main.py'));
  assert.ok(m('top.py'), '**/ also matches the root level');
  assert.ok(m('a/b/c.py'));
  assert.ok(m('infra/Dockerfile'));
  assert.ok(!m('infrastructure/x'), 'a plain path is a directory prefix, not a string prefix');
  assert.ok(!L.matcher(['*.py'])('a/b.py'), '* stays inside one directory');
});

test('globs: braces, ? and exclusions', () => {
  const m = L.matcher(['src/**/*.{ts,tsx}', '!src/**/*.test.ts', 'a?c.txt']);
  assert.ok(m('src/x/y.tsx'));
  assert.ok(m('src/y.ts'));
  assert.ok(!m('src/x/y.test.ts'));
  assert.ok(m('abc.txt'));
  assert.ok(!m('ac.txt'));
});

// ------------------------------------------------------------------ registry validation

test('registry: rejects reserved, malformed and dangling entries', () => {
  const bad = {
    schema: 1,
    modules: {
      project: { layers: { backend: ['x/**'] } },
      'Bad Name': { layers: { backend: ['x/**'] } },
      a: { layers: { cloud: ['x/**'] }, depends_on: ['ghost'] },
      b: { layers: { backend: ['../outside/**'] } },
      c: { layers: { backend: ['C:/abs/**'] }, depends_on: ['c'] },
      d: { layers: { backend: [] } },
      e: { layers: {} },
    },
  };
  const { errors } = L.validateRegistry(bad);
  const all = errors.join('\n');
  for (const needle of ['reserved', 'must match', 'unknown layer "cloud"', '"ghost" is not a module', 'inside the project', 'cannot depend on itself', 'non-empty array', 'non-empty object']) {
    assert.match(all, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `expected an error mentioning: ${needle}`);
  }
});

test('registry: the shared fixture is valid and tracks are derived', () => {
  assert.deepEqual(L.validateRegistry(REGISTRY).errors, []);
  assert.equal(L.trackOf(REGISTRY.modules.assistant), 'hybrid');
  assert.equal(L.trackOf(REGISTRY.modules.api), 'normal');
  assert.equal(L.trackOf({ layers: { ai: ['x/**'] } }), 'ai');
});

// ------------------------------------------------------------------ first run

test('first run: every cell is never-reviewed, dependencies are ordered before dependents', () => {
  const root = makeProject();
  const plan = planOf(root);
  assert.equal(plan.skipped.length, 0);
  assert.deepEqual(ids(plan.work).slice(0, 1), ['project/deps'], 'dependency cell goes first');
  const order = ids(plan.work);
  assert.ok(order.indexOf('shared-lib/backend') < order.indexOf('api/backend'));
  assert.ok(order.indexOf('shared-lib/backend') < order.indexOf('assistant/ai'));
  assert.equal(plan.work.length, 7, 'deps + 6 module layers');
  assert.ok(plan.work.every((w) => w.action === 'review-full' || w.action === 'deps-audit'));
  assert.equal(plan.work.find((w) => w.id === 'assistant/ai').skill, 'dp-ai-review');
  assert.equal(plan.work.find((w) => w.id === 'assistant/backend').skill, 'dp-module-review');
});

test('lockfiles belong to the dependency cell, not to a module layer', () => {
  const root = makeProject();
  const ev = L.evaluate(ctxOf(root));
  const web = ev.cells.find((c) => c.id === 'web-ui/frontend');
  assert.ok(!('apps/web/package-lock.json' in web.files));
  assert.ok('apps/web/package.json' in web.files);
  const deps = ev.cells.find((c) => c.id === 'project/deps');
  assert.ok('apps/web/package-lock.json' in deps.files);
  assert.ok('services/api/requirements.txt' in deps.files);
});

test('second run with nothing changed skips every cell, and writing progress.md does not stale anything', () => {
  const root = makeProject();
  recordAll(root);
  L.writeProgress(ctxOf(root));
  const plan = planOf(root);
  assert.equal(plan.work.length, 0);
  assert.equal(plan.skipped.length, 7);
  assert.equal(statusOf(root).rollup, 'SHIP');
  assert.match(fs.readFileSync(path.join(root, 'reviews', L.PROGRESS_FILE), 'utf8'), /\*\*Overall: SHIP\*\*/);
});

// ------------------------------------------------------------------ incremental behaviour

test('editing one file stales exactly that cell, as a diff', () => {
  const root = makeProject();
  recordAll(root);
  put(root, 'apps/web/src/App.tsx', 'export const App = () => "changed";\n');
  const plan = planOf(root);
  assert.deepEqual(ids(plan.work), ['web-ui/frontend']);
  assert.equal(plan.work[0].action, 'review-diff');
  assert.deepEqual(plan.work[0].changed_files, ['apps/web/src/App.tsx']);
  assert.equal(plan.skipped.length, 6);
});

test('changing a shared module stales its dependents as an interface check, not a full review', () => {
  const root = makeProject();
  recordAll(root);
  put(root, 'packages/shared/index.ts', 'export const add = (a: number, b: number) => a - b;\n');
  const plan = planOf(root);
  const byId = Object.fromEntries(plan.work.map((w) => [w.id, w]));
  assert.deepEqual(Object.keys(byId).sort(), ['api/backend', 'assistant/ai', 'assistant/backend', 'shared-lib/backend']);
  assert.equal(byId['shared-lib/backend'].action, 'review-diff');
  for (const id of ['api/backend', 'assistant/ai', 'assistant/backend']) {
    assert.equal(byId[id].action, 'interface-check');
    assert.equal(byId[id].cost, 'small');
    assert.equal(byId[id].reasons[0].module, 'shared-lib');
  }
  assert.ok(plan.work[0].id === 'shared-lib/backend', 'dependency is reviewed first');
});

test('--no-dependents defers the interface checks but keeps them visible', () => {
  const root = makeProject();
  recordAll(root);
  put(root, 'packages/shared/index.ts', 'changed\n');
  const plan = planOf(root, { noDependents: true });
  assert.deepEqual(ids(plan.work), ['shared-lib/backend']);
  assert.equal(plan.deferred.length, 3);
});

test('a new module creates only its own cells', () => {
  const root = makeProject();
  recordAll(root);
  put(root, 'services/billing/app.py', 'def charge():\n    pass\n');
  const reg = structuredClone(REGISTRY);
  reg.modules.billing = { layers: { backend: ['services/billing/**'] } };
  put(root, 'reviews/.ledger/registry.json', JSON.stringify(reg));
  const plan = planOf(root);
  assert.deepEqual(ids(plan.work), ['billing/backend']);
  assert.equal(plan.work[0].reasons[0].type, 'never');
  assert.equal(plan.skipped.length, 7);
});

test('lockfile change stales only the dependency cell; package.json also stales its module', () => {
  const root = makeProject();
  recordAll(root);
  put(root, 'apps/web/package-lock.json', '{"lockfileVersion":3,"x":1}\n');
  assert.deepEqual(ids(planOf(root).work), ['project/deps']);
  put(root, 'apps/web/package.json', '{"name":"web","dependencies":{"react":"18.3.0"}}\n');
  assert.deepEqual(ids(planOf(root).work).sort(), ['project/deps', 'web-ui/frontend']);
});

test('dependency audit goes stale by age with no file change, and only that cell', () => {
  const root = makeProject();
  recordAll(root, '2026-11-01');
  assert.equal(planOf(root, { now: '2026-11-10' }).work.length, 0);
  const plan = planOf(root, { now: '2026-11-16' });
  assert.deepEqual(ids(plan.work), ['project/deps']);
  assert.equal(plan.work[0].reasons[0].type, 'ttl');
});

test('line endings and a BOM do not change the fingerprint; a real edit does', () => {
  const root = makeProject();
  recordAll(root);
  put(root, 'services/api/app/main.py', '\uFEFFdef handler():\r\n    return 1\r\n');
  assert.equal(planOf(root).work.length, 0, 'CRLF + BOM only');
  put(root, 'services/api/app/main.py', 'def handler():\n    return 999\n');
  assert.deepEqual(ids(planOf(root).work), ['api/backend']);
});

test('a deleted file and an added file are both detected', () => {
  const root = makeProject();
  recordAll(root);
  fs.rmSync(path.join(root, 'services/api/requirements.txt'));
  put(root, 'services/api/app/extra.py', 'x = 1\n');
  const plan = planOf(root);
  const api = plan.work.find((w) => w.id === 'api/backend');
  assert.deepEqual(api.changed_files, ['services/api/app/extra.py', 'services/api/requirements.txt'], 'a manifest belongs to its module cell and to the dependency cell');
  const deps = plan.work.find((w) => w.id === 'project/deps');
  assert.deepEqual(deps.changed_files, ['services/api/requirements.txt']);
});

// ------------------------------------------------------------------ scope

test('scope: normal, ai and module-wise select the right cells', () => {
  const root = makeProject();
  const normal = ids(planOf(root, { scope: 'normal' }).work);
  assert.ok(normal.includes('project/deps') && !normal.includes('assistant/ai') && normal.includes('assistant/backend'));
  const ai = ids(planOf(root, { scope: 'ai' }).work);
  assert.deepEqual(ai, ['assistant/ai']);
  const mod = planOf(root, { scope: 'module:assistant' });
  assert.deepEqual(ids(mod.work).sort(), ['assistant/ai', 'assistant/backend']);
  assert.equal(mod.out_of_scope.length, 5, 'everything else is never-reviewed but outside the scope');
  assert.deepEqual(ids(planOf(root, { scope: ['module:assistant:ai'] }).work), ['assistant/ai']);
  assert.throws(() => planOf(root, { scope: 'nonsense' }), /Unknown scope/);
});

test('--rerun-all forces every in-scope cell, including clean ones', () => {
  const root = makeProject();
  recordAll(root);
  const plan = planOf(root, { rerunAll: true });
  assert.equal(plan.work.length, 7);
  assert.ok(plan.work.every((w) => w.reasons[0].type === 'rerun'));
  assert.equal(plan.work.find((w) => w.id === 'project/deps').action, 'deps-audit');
  assert.equal(plan.work.find((w) => w.id === 'api/backend').action, 'review-full');
  assert.equal(planOf(root, { rerunAll: true, scope: 'ai' }).work.length, 1);
});

// ------------------------------------------------------------------ findings

test('an open High finding BLOCKs, stays listed while its file is unchanged, and is not re-queued', () => {
  const root = makeProject();
  recordAll(root);
  const r = rec(root, 'assistant/ai', { findings: [F()] }, { verdict: 'BLOCK' });
  assert.equal(r.verdict, 'BLOCK');
  assert.deepEqual(r.warnings.filter((w) => !/begin/.test(w)), []);
  const plan = planOf(root);
  assert.equal(plan.work.length, 0);
  const s = plan.skipped.find((x) => x.id === 'assistant/ai');
  assert.equal(s.state, 'open');
  assert.equal(s.open, 1);
  const st = statusOf(root);
  assert.equal(st.rollup, 'BLOCK');
  assert.equal(st.open.High, 1);
  L.writeProgress(ctxOf(root));
  assert.match(fs.readFileSync(path.join(root, 'reviews', L.PROGRESS_FILE), 'utf8'), /\| F-1 \| assistant\/ai \| High/);
});

test('a fix is verified, not believed: edit the file and the finding must be replayed', () => {
  const root = makeProject();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F()] });
  put(root, 'services/assistant/llm/answer.py', 'def answer(page):\n    return escape(page)\n');
  const plan = planOf(root);
  assert.deepEqual(ids(plan.work), ['assistant/ai']);
  assert.deepEqual(plan.work[0].replay, ['F-1']);

  assert.throws(() => rec(root, 'assistant/ai', {}, { kind: 'diff' }), /not accounted for: F-1/, 'a review that says nothing cannot make a finding disappear');
  assert.throws(() => rec(root, 'assistant/ai', { resolved: [{ id: 'F-404', evidence: 'x' }] }, { kind: 'diff' }), /not found in the previous review/);

  const r = rec(root, 'assistant/ai', { resolved: [{ id: 'F-1', evidence: 'answer() now escapes before render_html()' }] }, { kind: 'diff' });
  assert.equal(r.verdict, 'SHIP');
  assert.equal(r.resolved, 1);
  const saved = ctxOf(root).readCell('assistant/ai');
  assert.deepEqual(Object.keys(saved.findings), []);
  assert.equal(saved.resolved[0].id, 'F-1');
  assert.match(saved.resolved[0].evidence, /escapes/);
  assert.equal(planOf(root).work.length, 0);
});

test('a finding that still reproduces stays open and keeps its first-seen date', () => {
  const root = makeProject();
  recordAll(root, '2026-11-01');
  rec(root, 'assistant/ai', { findings: [F()] }, {}, '2026-11-01');
  put(root, 'services/assistant/llm/answer.py', 'def answer(page):\n    return render_html(page)  # edited\n');
  rec(root, 'assistant/ai', { findings: [F({ line: 2 })] }, { kind: 'diff' }, '2026-11-05');
  const saved = ctxOf(root, '2026-11-05').readCell('assistant/ai');
  assert.equal(saved.findings['F-1'].state, 'open');
  assert.equal(saved.findings['F-1'].first_seen, '2026-11-01');
});

test('a diff review only has to account for findings in files that changed', () => {
  const root = makeProject();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F()] });
  put(root, 'services/assistant/prompts/system.txt', 'You are a very helpful assistant.\n');
  const r = rec(root, 'assistant/ai', {}, { kind: 'diff' });
  assert.equal(r.verdict, 'BLOCK', 'F-1 is in an unchanged file, so it carries forward');
  assert.equal(ctxOf(root).readCell('assistant/ai').findings['F-1'].state, 'open');
});

test('accepting: Critical is refused, a reason is required, acceptance lapses on file change and on expiry', () => {
  const root = makeProject();
  recordAll(root, '2026-11-01');
  rec(root, 'assistant/ai', { findings: [F(), F({ id: 'F-2', severity: 'Critical', title: 'Key in prompt' })] }, {}, '2026-11-01');
  const c = () => ctxOf(root, '2026-11-01');
  assert.throws(() => L.acceptFinding(c(), 'assistant/ai', 'F-2', { reason: 'we will live with it' }), /Critical/);
  assert.throws(() => L.acceptFinding(c(), 'assistant/ai', 'F-1', { reason: 'ok' }), /--reason/);
  assert.throws(() => L.acceptFinding(c(), 'assistant/ai', 'F-1', { reason: 'long enough reason', expires: '2020-01-01' }), /future/);
  assert.throws(() => L.acceptFinding(c(), 'assistant/ai', 'F-9', { reason: 'long enough reason' }), /no finding/);

  rec(root, 'assistant/ai', { resolved: [{ id: 'F-2', evidence: 'key moved to env' }], findings: [F()] }, { kind: 'full' }, '2026-11-01');
  L.acceptFinding(c(), 'assistant/ai', 'F-1', { reason: 'internal tool, sink is sandboxed', days: 10, by: 'rk' });
  assert.equal(statusOf(root, { now: '2026-11-01' }).cells.find((x) => x.id === 'assistant/ai').verdict, 'SHIP WITH FIXES', 'an accepted High is SHIP WITH FIXES');

  assert.equal(statusOf(root, { now: '2026-11-12' }).rollup, 'BLOCK', 'expired acceptance reopens it');
  put(root, 'services/assistant/llm/answer.py', 'def answer(page):\n    return render_html(page) # touched\n');
  const lapsed = ctxOf(root, '2026-11-02');
  const eff = L.evaluate(lapsed).cells.find((x) => x.id === 'assistant/ai').findings[0];
  assert.equal(eff.eff, 'open');
  assert.equal(eff.lapse, 'file-changed');

  L.reopenFinding(c(), 'assistant/ai', 'F-1');
  assert.equal(ctxOf(root).readCell('assistant/ai').findings['F-1'].state, 'open');
});

test('an incomplete review is not current and caps at SHIP WITH FIXES', () => {
  const root = makeProject();
  recordAll(root);
  const r = rec(root, 'api/backend', {}, { incomplete: true });
  assert.equal(r.verdict, 'SHIP WITH FIXES');
  const plan = planOf(root);
  assert.deepEqual(ids(plan.work), ['api/backend']);
  assert.equal(plan.work[0].action, 'review-full');
  assert.equal(statusOf(root).rollup, 'INCOMPLETE');
});

test('BLOCK for a non-finding reason needs --block-rule; a stricter reported verdict warns', () => {
  const root = makeProject();
  recordAll(root);
  const warn = rec(root, 'api/backend', {}, { verdict: 'BLOCK' });
  assert.equal(warn.verdict, 'SHIP');
  assert.match(warn.warnings.join(' '), /--block-rule/);
  const ok = rec(root, 'api/backend', {}, { verdict: 'BLOCK', blockRule: 'tests fail on main' });
  assert.equal(ok.verdict, 'BLOCK');
  assert.deepEqual(ok.warnings.filter((w) => !/begin/.test(w)), []);
  assert.match(statusOf(root).check.problems.join('\n'), /tests fail on main/);
});

test('findings input is validated: ids, severity, scenario, and paths that escape the project', () => {
  const root = makeProject();
  recordAll(root);
  const bad = (f) => () => rec(root, 'assistant/ai', { findings: [f] });
  assert.throws(bad(F({ id: 'has space' })), /id must match/);
  assert.throws(bad(F({ severity: 'Severe' })), /severity/);
  assert.throws(bad(F({ scenario: '' })), /scenario is required/);
  assert.throws(bad(F({ file: '../../etc/passwd' })), /relative to the project/);
  assert.throws(bad(F({ file: '/etc/passwd' })), /relative to the project/);
  assert.throws(bad(F({ line: 0 })), /line/);
  assert.throws(bad(F({ check: { regex: '(' } })), /regular expression/);
  assert.throws(() => rec(root, 'assistant/ai', { findings: [F(), F()] }), /duplicate/);
  assert.throws(() => rec(root, 'nope/backend'), /Unknown cell/);
  assert.throws(() => rec(root, 'api/backend', {}, { kind: 'deps' }), /only for project\/deps/);
  assert.throws(() => rec(root, 'project/deps', {}, { kind: 'full' }), /--kind deps/);
});

test('findings may use lower-case severity; baseline findings are stored as accepted', () => {
  const root = makeProject();
  recordAll(root);
  const r = rec(root, 'assistant/ai', { findings: [F({ severity: 'medium', id: 'F-5' }), F({ id: 'F-6', severity: 'High', baseline: true })] });
  assert.equal(r.open.Medium, 1);
  assert.equal(r.open.High, 0, 'a baseline-accepted High is not open');
  assert.equal(r.verdict, 'SHIP WITH FIXES');
  assert.equal(ctxOf(root).readCell('assistant/ai').findings['F-6'].accepted.by, 'baseline');
});

test('recheck gives hints from machine checks and never changes state', () => {
  const root = makeProject();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F({ check: { regex: 'render_html\\(page\\)' } }), F({ id: 'F-2', severity: 'Low', title: 'no check' })] });
  let hints = Object.fromEntries(L.recheck(ctxOf(root), 'assistant/ai').map((h) => [h.id, h.hint]));
  assert.deepEqual(hints, { 'F-1': 'still-present', 'F-2': 'no-check' });
  put(root, 'services/assistant/llm/answer.py', 'def answer(page):\n    return escape(page)\n');
  hints = Object.fromEntries(L.recheck(ctxOf(root), 'assistant/ai').map((h) => [h.id, h.hint]));
  assert.equal(hints['F-1'], 'pattern-gone');
  assert.equal(ctxOf(root).readCell('assistant/ai').findings['F-1'].state, 'open', 'a hint is not a fix');
});

// ------------------------------------------------------------------ snapshots and interface checks

test('begin snapshots before the review, so an edit made during the review is not blessed', () => {
  const root = makeProject();
  recordAll(root);
  L.beginCell(ctxOf(root), 'web-ui/frontend');
  put(root, 'apps/web/src/App.tsx', 'export const App = () => "edited mid-review";\n');
  const r = rec(root, 'web-ui/frontend');
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(ids(planOf(root).work), ['web-ui/frontend'], 'the mid-review edit is still pending');
  assert.ok(!fs.existsSync(path.join(root, 'reviews/.ledger/pending/web-ui__frontend.json')), 'snapshot consumed');
});

test('recording without begin works but warns', () => {
  const root = makeProject();
  const r = rec(root, 'web-ui/frontend');
  assert.match(r.warnings[0], /no `begin` snapshot/);
});

test('an interface check clears the upstream reason without touching the own-file fingerprint', () => {
  const root = makeProject();
  recordAll(root);
  const before = ctxOf(root).readCell('api/backend').fingerprint;
  put(root, 'packages/shared/index.ts', 'changed\n');
  rec(root, 'api/backend', { findings: [F({ id: 'F-9', severity: 'Medium', file: 'services/api/app/main.py', title: 'trusts shared auth helper' })] }, { kind: 'interface' });
  const after = ctxOf(root).readCell('api/backend');
  assert.equal(after.fingerprint, before);
  assert.ok(!ids(planOf(root).work).includes('api/backend'));
  assert.equal(after.findings['F-9'].state, 'open');
  assert.throws(() => rec(root, 'billing/backend', {}, { kind: 'interface' }), /Unknown cell/);
  assert.throws(() => rec(makeProject(HYBRID), 'api/backend', {}, { kind: 'diff' }), /no earlier review/);
});

test('adding a dependency in the registry stales that module as an interface check', () => {
  const root = makeProject();
  recordAll(root);
  const reg = structuredClone(REGISTRY);
  reg.modules['web-ui'].depends_on = ['shared-lib'];
  put(root, 'reviews/.ledger/registry.json', JSON.stringify(reg));
  const plan = planOf(root);
  assert.deepEqual(ids(plan.work), ['web-ui/frontend']);
  assert.equal(plan.work[0].reasons[0].newDependency, true);
});

// ------------------------------------------------------------------ coverage, orphans, ruleset

test('files no cell reviews are reported; docs and images are not', () => {
  const reg = structuredClone(REGISTRY);
  delete reg.modules.ops;
  const root = makeProject(HYBRID, reg);
  const un = planOf(root).uncovered;
  assert.deepEqual(un.sample.sort(), ['.github/workflows/ci.yml', 'infra/Dockerfile']);
  assert.ok(!un.sample.includes('README.md'));
  assert.equal(planOf(makeProject()).uncovered.count, 0);
});

test('a module removed from the registry leaves an orphan record that prune deletes', () => {
  const root = makeProject();
  recordAll(root);
  const reg = structuredClone(REGISTRY);
  delete reg.modules.ops;
  put(root, 'reviews/.ledger/registry.json', JSON.stringify(reg));
  const ctx = ctxOf(root);
  const ev = L.evaluate(ctx);
  assert.deepEqual(ev.orphans, ['ops/infra']);
  assert.equal(L.pruneOrphans(ctx, ev).length, 1);
  assert.deepEqual(L.evaluate(ctxOf(root)).orphans, []);
});

test('a ruleset change is a note, not a forced re-run', () => {
  const root = makeProject();
  recordAll(root);
  const ctx = L.loadContext(root, { ruleset: 'T2' });
  const plan = L.buildPlan(ctx, L.evaluate(ctx), {});
  assert.equal(plan.work.length, 0);
  assert.equal(plan.ruleset_behind.length, 7);
});

test('a symlinked or unreadable path never crashes planning', () => {
  const root = makeProject();
  try {
    fs.symlinkSync(path.join(root, 'README.md'), path.join(root, 'services/api/link.md'));
  } catch {
    return; // symlinks need privileges on some Windows setups
  }
  assert.ok(planOf(root).work.length > 0);
});

test('git mode honours .gitignore and still sees untracked files', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('git not installed');
  const root = makeProject({ ...HYBRID, '.gitignore': 'secret.txt\n', 'secret.txt': 's', 'untracked.py': 'x=1\n' }, null);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  const files = L.listFiles(root);
  assert.ok(files.includes('untracked.py'));
  assert.ok(!files.includes('secret.txt'));
  assert.ok(!files.some((f) => f.startsWith('reviews/')));
});

// ------------------------------------------------------------------ CLI end to end

const cli = (root, args, input) => spawnSync(process.execPath, [LEDGER_PATH, ...args, '--root', root, '--ruleset', 'T1'], { encoding: 'utf8', input });

test('cli: registry set, plan, record, status --check exit codes, render', () => {
  const root = makeProject(HYBRID, null);
  const regFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-reg-')), 'reg.json');
  fs.writeFileSync(regFile, JSON.stringify(REGISTRY));
  assert.equal(cli(root, ['registry', 'set', regFile]).status, 0);
  assert.match(cli(root, ['registry', 'check']).stdout, /Registry OK: 5 modules, 7 cells/);

  const plan = JSON.parse(cli(root, ['plan', '--json']).stdout);
  assert.equal(plan.work.length, 7);

  assert.equal(cli(root, ['status', '--check']).status, 1, 'never-reviewed cells fail the CI check');
  assert.equal(cli(root, ['status', '--check', '--allow-stale']).status, 0);

  for (const c of plan.work) {
    const args = ['record', c.id];
    const findings = c.id === 'assistant/ai' ? ['--findings', '-'] : [];
    const r = cli(root, [...args, ...findings], c.id === 'assistant/ai' ? JSON.stringify({ findings: [F()] }) : undefined);
    assert.equal(r.status, 0, r.stderr);
  }
  const st = cli(root, ['status', '--check']);
  assert.equal(st.status, 1);
  assert.match(st.stdout, /assistant\/ai: 1 High finding open/);
  assert.equal(cli(root, ['status', '--check', '--fail-on', 'Critical']).status, 0, 'High is below a Critical threshold');

  assert.equal(cli(root, ['accept', 'assistant/ai', 'F-1', '--reason', 'sink is sandboxed', '--days', '30']).status, 0);
  assert.equal(cli(root, ['status', '--check']).status, 0);
  assert.match(fs.readFileSync(path.join(root, 'reviews/security-progress.md'), 'utf8'), /SHIP WITH FIXES/);

  assert.equal(cli(root, ['render']).status, 0);
  assert.match(cli(root, ['coverage']).stdout, /Uncovered code or config files: 0/);
  assert.match(cli(root, ['help']).stdout, /progress ledger/);
});

test('cli: errors exit 2 with a readable message', () => {
  const root = makeProject(HYBRID, null);
  const noReg = cli(root, ['plan']);
  assert.equal(noReg.status, 2);
  assert.match(noReg.stderr, /No registry/);
  fs.writeFileSync(path.join(root, 'bad.json'), '{"schema":1,"modules":{"a":{"layers":{"nope":["x"]}}}}');
  const bad = cli(root, ['registry', 'set', path.join(root, 'bad.json')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown layer/);
  assert.ok(!fs.existsSync(path.join(root, 'reviews/.ledger/registry.json')), 'an invalid registry is never written');
  assert.equal(cli(root, ['frobnicate']).status, 2);
});

test('ledger files are written with stable key order so commits diff cleanly', () => {
  const root = makeProject();
  recordAll(root);
  const text = fs.readFileSync(path.join(root, 'reviews/.ledger/cells/api__backend.json'), 'utf8');
  const keys = Object.keys(JSON.parse(text));
  assert.deepEqual(keys, [...keys].sort());
  assert.ok(text.endsWith('\n'));
});
