// Tests for findings that live in files OUTSIDE their own cell. Run from the plugin root:
//   node --test tests/ledger-foreign.test.mjs
// A fix in another module's file does not change this cell's fingerprint, so without tracking those
// locations a finding would stay open forever and never be replayed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../skills/dp-security/ledger.mjs';

const LEDGER_PATH = fileURLToPath(new URL('../skills/dp-security/ledger.mjs', import.meta.url));
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;

const FILES = {
  'apps/engine/app/a.py': 'def a():\n    return 1\n',
  'apps/engine/app/b.py': 'def b():\n    return 2\n',
  'apps/api/routes/reports.py': 'def reports():\n    return 3\n',
  'apps/api/main.py': 'def main():\n    return 4\n',
  'loose/script.py': 'x = 5\n',
};
const REGISTRY = {
  schema: 1,
  modules: { engine: { layers: { ai: ['apps/engine/**'] } }, api: { layers: { backend: ['apps/api/**'] } } },
};

function project({ git = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-foreign-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  for (const [rel, text] of Object.entries(FILES)) put(rel, text);
  put('reviews/.ledger/registry.json', JSON.stringify(REGISTRY));
  let head = null;
  if (git) {
    const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' });
    g('init', '-q');
    g('add', '-A');
    g('commit', '-q', '-m', 'init');
    head = g('rev-parse', '--short', 'HEAD').stdout.trim();
  }
  return { root, head, put };
}

const ctx = (root) => L.loadContext(root, { ruleset: 'T1' });
const plan = (root) => {
  const c = ctx(root);
  return L.buildPlan(c, L.evaluate(c), {});
};
const cellOf = (root, id) => L.evaluate(ctx(root)).cells.find((c) => c.id === id);
const rec = (root, id, input = {}, o = {}) => L.recordCell(ctx(root), id, input, o);
const recordAll = (root) => {
  for (const c of L.evaluate(ctx(root)).cells) rec(root, c.id);
};

const F = (o = {}) => ({
  id: 'F1', severity: 'High', title: 'Debug output reaches the tenant admin',
  file: 'apps/engine/app/a.py', also: ['apps/api/routes/reports.py'], line: 2,
  scenario: 'a() puts settings into the log and reports() serves it unredacted.', ...o,
});

test('a change in ANOTHER cell where a finding lives queues a replay of that finding', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  assert.equal(plan(root).work.length, 0, 'nothing has changed yet');

  put('apps/api/routes/reports.py', 'def reports():\n    return redact(3)\n');
  const work = plan(root).work;
  const engine = work.find((w) => w.id === 'engine/ai');
  assert.ok(engine, 'the engine cell is queued although none of its own files changed');
  assert.equal(engine.reasons[0].type, 'finding-location');
  assert.deepEqual(engine.reasons[0].files, ['apps/api/routes/reports.py']);
  assert.equal(engine.action, 'review-diff');
  assert.equal(engine.cost, 'small');
  assert.deepEqual(engine.replay, ['F1']);
  assert.deepEqual(engine.changed_files, []);
  assert.ok(work.some((w) => w.id === 'api/backend'), 'and the api cell is queued for its own change, as before');
});

test('a change in an unrelated file of the other cell does not', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  put('apps/api/main.py', 'def main():\n    return 44\n');
  assert.ok(!plan(root).work.some((w) => w.id === 'engine/ai'));
});

test('the replay is owed: a diff record that ignores the moved finding is refused, then cleared by answering it', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  put('apps/api/routes/reports.py', 'def reports():\n    return redact(3)\n');
  assert.throws(() => rec(root, 'engine/ai', {}, { kind: 'diff' }), /not accounted for: F1/);

  rec(root, 'engine/ai', { findings: [F()] }, { kind: 'diff' });
  assert.ok(!plan(root).work.some((w) => w.id === 'engine/ai'), 're-listing it refreshes what the location looked like');

  put('apps/api/routes/reports.py', 'def reports():\n    return redact(redact(3))\n');
  const r = rec(root, 'engine/ai', { resolved: [{ id: 'F1', evidence: 'reports.py:2 now redacts before serving' }] }, { kind: 'diff' });
  assert.equal(r.resolved, 1);
  assert.equal(r.verdict, 'SHIP');
});

test('the brief for such a cell is a diff with nothing changed in the cell and the finding to replay', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  put('apps/api/routes/reports.py', 'def reports():\n    return redact(3)\n');
  const c = ctx(root);
  const b = L.buildBrief(c, L.evaluate(c), 'engine/ai');
  assert.equal(b.kind, 'diff');
  assert.deepEqual(b.changed_files, []);
  assert.deepEqual(b.replay.map((f) => f.id), ['F1']);
  assert.match(b.reasons[0], /files outside this cell changed where findings live: F1 \(apps\/api\/routes\/reports\.py\)/);
});

test('a deleted location counts as a change', () => {
  const { root } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  fs.rmSync(path.join(root, 'apps/api/routes/reports.py'));
  assert.deepEqual(plan(root).work.find((w) => w.id === 'engine/ai')?.replay, ['F1']);
});

test('a finding whose file is in NO cell is tracked too', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F({ file: 'loose/script.py', also: [], id: 'F2' })] });
  assert.equal(plan(root).work.length, 0);
  put('loose/script.py', 'x = 6\n');
  assert.deepEqual(plan(root).work.find((w) => w.id === 'engine/ai')?.replay, ['F2']);
});

test('an accepted finding is replayed once its other location changes, because the acceptance lapses', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  L.acceptFinding(ctx(root), 'engine/ai', 'F1', { reason: 'debug are internal only', days: 30 });
  assert.equal(plan(root).work.length, 0);
  put('apps/api/routes/reports.py', 'def reports():\n    return 33\n');
  assert.deepEqual(plan(root).work.find((w) => w.id === 'engine/ai')?.replay, ['F1']);
});

test('a record written before locations were tracked never triggers, so old ledgers keep working', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  const file = path.join(root, 'reviews/.ledger/cells/engine__ai.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.findings.F1.loc_hashes;
  fs.writeFileSync(file, JSON.stringify(saved));
  put('apps/api/routes/reports.py', 'def reports():\n    return 33\n');
  assert.ok(!plan(root).work.some((w) => w.id === 'engine/ai'));
});

test('an interface check never owes an answer for moved locations', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  put('apps/api/routes/reports.py', 'def reports():\n    return 33\n');
  assert.doesNotThrow(() => rec(root, 'engine/ai', {}, { kind: 'interface' }));
});

// ------------------------------------------------------------------ import

const legacy = (head) => ({
  schema: 'dp-ai-review.sidecar/1', component: 'apps/engine', date: '2026-11-05', base_commit: head, depth: 'deep', verdict: 'BLOCK',
  findings: [{ id: 'F12', sev: 'High', status: 'CONFIRMED', title: 'Debug output reaches the tenant admin', where: ['app/a.py:2', 'apps/api/routes/reports.py:1'] }],
});
const writeSidecar = (root, body) => {
  const f = path.join(root, 'reviews', 'engine-ai-review-2026-11-05.json');
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};

test('import: a location in another cell that changed since the review is recorded as unknown and replayed at once', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put } = project({ git: true });
  const side = writeSidecar(root, legacy(head));
  put('apps/api/routes/reports.py', 'def reports():\n    return redact(3)\n');
  const r = L.importCell(ctx(root), 'engine/ai', side, {});
  assert.deepEqual(r.imported.unproven_locations, ['apps/api/routes/reports.py']);
  assert.equal(ctx(root).readCell('engine/ai').findings.F12.loc_hashes['apps/api/routes/reports.py'], null);
  const engine = plan(root).work.find((w) => w.id === 'engine/ai');
  assert.ok(engine, 'the import cannot vouch for a file that moved after the review');
  assert.deepEqual(engine.replay, ['F12']);
});

test('import: a location in another cell that did NOT change leaves the cell current', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project({ git: true });
  const r = L.importCell(ctx(root), 'engine/ai', writeSidecar(root, legacy(head)), {});
  assert.deepEqual(r.imported.unproven_locations, []);
  assert.ok(!plan(root).work.some((w) => w.id === 'engine/ai'));
  assert.equal(cellOf(root, 'engine/ai').state, 'open');
});

test('cli: plan explains why a cell with unchanged files is queued', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'engine/ai', { findings: [F()] });
  put('apps/api/routes/reports.py', 'def reports():\n    return 33\n');
  const r = spawnSync(process.execPath, [LEDGER_PATH, 'plan', '--root', root, '--ruleset', 'T1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /engine\/ai\s+\[dp-ai-review\]\s+review-diff \(small\)/);
  assert.match(r.stdout, /files outside this cell changed where findings live: F1 \(apps\/api\/routes\/reports\.py\)/);
  assert.match(r.stdout, /replay first: F1/);
});
