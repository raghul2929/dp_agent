// Import and overwrite-guard tests for skills/dp-security/ledger.mjs. Run from the plugin root:
//   node --test tests/ledger-import.test.mjs
// `import` records a review that ran before the ledger existed. The sidecar shape here is the one
// dp-ai-review wrote in a real project: `sev`, and `where` as a list of "path:lines" strings that
// are relative to the component, not to the project root.
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
  'apps/engine/app/graph/builder.py': 'import langgraph\n\ndef build():\n    return 1\n',
  'apps/engine/app/providers/llm.py': 'import openai\n\ndef call():\n    return 2\n',
  'apps/engine/app/api/debug.py': 'def debug():\n    return 3\n',
  'apps/engine/app/exporters/rfp.py': 'def export():\n    return 4\n',
  'apps/api/app/debug.py': 'def api_debug():\n    return 5\n',
  'apps/api/app/main.py': 'def main():\n    return 6\n',
};
const REGISTRY = {
  schema: 1,
  modules: {
    engine: { layers: { ai: ['apps/engine/**'] } },
    api: { layers: { backend: ['apps/api/**'] } },
  },
};

function put(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

// A project, optionally a git repo with everything committed. Returns { root, head }.
function project({ git = true, files = FILES } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-import-'));
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  put(root, 'reviews/.ledger/registry.json', JSON.stringify(REGISTRY));
  let head = null;
  if (git) {
    const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' });
    g('init', '-q');
    g('add', '-A');
    g('commit', '-q', '-m', 'init');
    head = g('rev-parse', '--short', 'HEAD').stdout.trim();
  }
  return { root, head, put: (rel, text) => put(root, rel, text) };
}

const ctx = (root, o = {}) => L.loadContext(root, { ruleset: 'T1', ...o });

// Shaped like the real sidecar: `where` is relative to apps/engine/app/, some entries reach into
// another component with a full path, and one finding has no code location at all.
const legacy = (head, extra = {}) => ({
  schema: 'dp-ai-review.sidecar/1',
  component: 'apps/engine',
  date: '2026-11-05',
  base_commit: head,
  depth: 'deep',
  verdict: 'BLOCK',
  findings: [
    { id: 'F12', sev: 'Critical', status: 'PROVEN+CONFIRMED', maps_to: 'LLM02', title: 'Debug output holds secrets', where: ['providers/llm.py:3-5', 'api/debug.py:1-2', 'apps/api/app/debug.py:1'] },
    { id: 'F17', sev: 'High', status: 'CONFIRMED', title: 'Export trusts model output', where: ['exporters/rfp.py:1,4-6'] },
    { id: 'F20', sev: 'Medium', status: 'evidence gap', title: 'No DPA on file', where: [] },
    { id: 'F21', sev: 'Low', status: 'metadata', title: 'Odd location', where: ['nowhere/ghost.py:9'] },
  ],
  refuted: [{ id: 'F36', claim: 'x', verdict: 'REFUTED' }],
  ...extra,
});

function sidecarFile(root, body) {
  const f = path.join(root, 'reviews', 'engine-ai-review-2026-11-05.json');
  fs.writeFileSync(f, JSON.stringify(body));
  fs.writeFileSync(f.replace(/\.json$/, '.md'), '# report\n');
  return f;
}

// ------------------------------------------------------------------ the generated file never clobbers yours

test('the generated view is security-progress.md, and a hand-written PROGRESS.md is never touched', () => {
  const { root } = project({ git: false });
  assert.equal(L.PROGRESS_FILE, 'security-progress.md');
  const mine = '# Review progress and how to resume\n\nHand-written notes.\n';
  put(root, 'reviews/PROGRESS.md', mine);
  const file = L.writeProgress(ctx(root));
  assert.equal(path.basename(file), 'security-progress.md');
  assert.equal(fs.readFileSync(path.join(root, 'reviews', 'PROGRESS.md'), 'utf8'), mine);
  assert.match(fs.readFileSync(file, 'utf8'), /^# Security review progress/);
});

test('a file with the generated name that ledger.mjs did not write is left alone', () => {
  const { root } = project({ git: false });
  put(root, 'reviews/security-progress.md', '# my own security notes\n');
  assert.throws(() => L.writeProgress(ctx(root)), /was not written by ledger\.mjs/);
  assert.equal(fs.readFileSync(path.join(root, 'reviews/security-progress.md'), 'utf8'), '# my own security notes\n');
  fs.rmSync(path.join(root, 'reviews/security-progress.md'));
  assert.doesNotThrow(() => L.writeProgress(ctx(root)), 'and it can be regenerated once moved');
  assert.doesNotThrow(() => L.writeProgress(ctx(root)), 'its own output is always safe to overwrite');
});

// ------------------------------------------------------------------ reading the real sidecar shape

test('legacy sidecar: sev and where become severity, file, line and extra locations', () => {
  const { root } = project({ git: false });
  const files = ctx(root).files;
  const n = L.normalizeLegacySidecar(legacy('x'), { files, base: 'apps/engine' });
  const f12 = n.findings.find((f) => f.id === 'F12');
  assert.equal(f12.severity, 'Critical');
  assert.equal(f12.file, 'apps/engine/app/providers/llm.py');
  assert.equal(f12.line, 3);
  assert.deepEqual(f12.also, ['apps/engine/app/api/debug.py', 'apps/api/app/debug.py'], 'a bare suffix, and a full path into another component');
  assert.equal(f12.maps_to, 'LLM02');
  assert.equal(f12.status, 'PROVEN+CONFIRMED');
  assert.match(f12.scenario, /Debug output holds secrets \[imported/);
  assert.equal(n.findings.find((f) => f.id === 'F17').line, 1, 'the first number of "1,4-6"');
});

test('legacy sidecar: a path that matches nothing is kept as a note, never guessed', () => {
  const { root } = project({ git: false });
  const n = L.normalizeLegacySidecar(legacy('x'), { files: ctx(root).files, base: 'apps/engine' });
  const gap = n.findings.find((f) => f.id === 'F20');
  assert.equal(gap.file, null);
  const ghost = n.findings.find((f) => f.id === 'F21');
  assert.equal(ghost.file, null);
  assert.match(ghost.note, /nowhere\/ghost\.py:9/);
  assert.equal(n.no_location, 2);
});

test('legacy sidecar: an ambiguous ending resolves only when the component folder decides it', () => {
  const { root } = project({ git: false, files: { ...FILES, 'apps/other/app/api/debug.py': 'x = 1\n' } });
  const files = ctx(root).files;
  const sc = { findings: [{ id: 'A1', sev: 'High', title: 't', where: ['api/debug.py:1'] }] };
  assert.equal(L.normalizeLegacySidecar(sc, { files, base: 'apps/engine' }).findings[0].file, 'apps/engine/app/api/debug.py');
  assert.equal(L.normalizeLegacySidecar(sc, { files, base: '' }).findings[0].file, null, 'two matches and no component: do not pick one');
});

test('legacy sidecar: an unknown severity is skipped and reported, not coerced', () => {
  const { root } = project({ git: false });
  const sc = { findings: [{ id: 'X1', sev: 'Blocker', title: 't', where: [] }, { id: 'X2', sev: 'Low', title: 'ok', where: [] }] };
  const n = L.normalizeLegacySidecar(sc, { files: ctx(root).files });
  assert.deepEqual(n.skipped, ['X1']);
  assert.deepEqual(n.findings.map((f) => f.id), ['X2']);
});

test('isLegacySidecar tells the real shape from the standard one', () => {
  assert.ok(L.isLegacySidecar(legacy('x')));
  assert.ok(!L.isLegacySidecar({ findings: [{ id: 'a', severity: 'High', title: 't', file: 'f', scenario: 's' }] }));
  assert.ok(!L.isLegacySidecar({ findings: [] }));
  assert.ok(!L.isLegacySidecar(null));
});

// ------------------------------------------------------------------ import

test('import records the review as it was: verdict derived, date and commit kept, cell not re-queued', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project();
  const side = sidecarFile(root, legacy(head));
  const r = L.importCell(ctx(root), 'engine/ai', side, {});
  assert.equal(r.verdict, 'BLOCK');
  assert.deepEqual(r.open, { Critical: 1, High: 1, Medium: 1, Low: 1 });
  assert.equal(r.imported.findings, 4);
  assert.equal(r.imported.no_location, 2);
  assert.equal(r.imported.report, 'reviews/engine-ai-review-2026-11-05.md');
  assert.deepEqual(r.warnings, []);

  const saved = ctx(root).readCell('engine/ai');
  assert.equal(saved.reviewed_at, '2026-11-05');
  assert.equal(saved.reviewed_commit, head);
  assert.equal(saved.depth, 'deep');
  assert.equal(saved.ruleset, 'unknown', 'the sidecar does not say which ruleset ran, so the record says so');
  assert.equal(saved.imported_from, 'reviews/engine-ai-review-2026-11-05.json');

  const c = ctx(root);
  const plan = L.buildPlan(c, L.evaluate(c), { scope: 'ai' });
  assert.equal(plan.work.length, 0, 'nothing changed since the review');
  assert.equal(plan.skipped[0].open, 4);
  assert.ok(plan.ruleset_behind.includes('engine/ai'), 'an unknown ruleset is shown as older, never as current');
});

test('after an import, editing ANY file a finding lists queues a replay of it', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put: write } = project();
  L.importCell(ctx(root), 'engine/ai', sidecarFile(root, legacy(head)), {});
  write('apps/engine/app/api/debug.py', 'def debug():\n    return redact(3)\n');
  const b = (() => {
    const c = ctx(root);
    return L.buildBrief(c, L.evaluate(c), 'engine/ai');
  })();
  assert.equal(b.kind, 'diff');
  assert.deepEqual(b.replay.map((f) => f.id), ['F12'], 'F12 lists debug.py as a secondary location');
  assert.deepEqual(b.carry_forward.sort(), ['F17', 'F20', 'F21']);
  assert.deepEqual(b.replay[0].also, ['apps/engine/app/api/debug.py', 'apps/api/app/debug.py']);
});

test('import refuses when the code changed since the base commit, and says which files', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put: write } = project();
  const side = sidecarFile(root, legacy(head));
  write('apps/engine/app/providers/llm.py', 'import openai\n\ndef call():\n    return 999\n');
  assert.throws(() => L.importCell(ctx(root), 'engine/ai', side, {}), /1 file in engine\/ai changed since the review's base commit .*llm\.py/s);
  assert.equal(ctx(root).readCell('engine/ai'), null, 'nothing was recorded');
});

test('import also refuses for a new untracked file inside the cell', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put: write } = project();
  const side = sidecarFile(root, legacy(head));
  write('apps/engine/app/new_tool.py', 'x = 1\n');
  assert.throws(() => L.importCell(ctx(root), 'engine/ai', side, {}), /new_tool\.py/);
});

test('changes outside the cell do not block the import', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put: write } = project();
  const side = sidecarFile(root, legacy(head));
  write('apps/api/app/main.py', 'def main():\n    return 12345\n');
  assert.equal(L.importCell(ctx(root), 'engine/ai', side, {}).verdict, 'BLOCK');
});

test('without git, or without a base commit, import refuses unless told the code is unchanged', () => {
  const { root } = project({ git: false });
  const side = sidecarFile(root, legacy('abc1234'));
  assert.throws(() => L.importCell(ctx(root), 'engine/ai', side, {}), /Cannot compare with commit abc1234/);
  const noCommit = sidecarFile(root, legacy(undefined));
  assert.throws(() => L.importCell(ctx(root), 'engine/ai', noCommit, {}), /no base_commit/);
  const r = L.importCell(ctx(root), 'engine/ai', noCommit, { assumeUnchanged: true });
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(ctx(root).readCell('engine/ai').reviewed_commit, null);
});

test('an unknown commit is refused, not skipped', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root } = project();
  assert.throws(() => L.importCell(ctx(root), 'engine/ai', sidecarFile(root, legacy('deadbee')), {}), /Cannot compare with commit deadbee/);
});

test('import will not overwrite a recorded cell, a missing sidecar, or a missing date', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project();
  const side = sidecarFile(root, legacy(head));
  L.importCell(ctx(root), 'engine/ai', side, {});
  assert.throws(() => L.importCell(ctx(root), 'engine/ai', side, {}), /already has a recorded review/);
  assert.throws(() => L.importCell(ctx(root), 'api/backend', path.join(root, 'reviews/ghost.json'), {}), /Sidecar not found/);
  const undated = sidecarFile(root, legacy(head, { date: 'yesterday' }));
  assert.throws(() => L.importCell(ctx(root), 'api/backend', undated, {}), /no valid "date"/);
  assert.throws(() => L.importCell(ctx(root), 'nope/ai', side, {}), /Unknown cell/);
  assert.throws(() => L.importCell(ctx(root), 'api/backend', sidecarFile(root, legacy(head, { date: '2999-01-01' })), {}), /future/);
});

test('findings with no file stay open and must be answered by the next full review', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project();
  L.importCell(ctx(root), 'engine/ai', sidecarFile(root, legacy(head)), {});
  const saved = ctx(root).readCell('engine/ai');
  assert.equal(saved.findings.F20.file, null);
  assert.equal(saved.findings.F20.state, 'open');
  const c = ctx(root);
  const brief = L.buildBrief(c, L.evaluate(c), 'engine/ai', { rerunAll: true });
  assert.equal(brief.replay.length, 4, 'a re-run replays every open finding, located or not');
  assert.throws(() => L.recordCell(ctx(root), 'engine/ai', { findings: [] }, { kind: 'full' }), /not accounted for/);
});

test('an import can be accepted per finding, and a change to a secondary location lapses it', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put: write } = project();
  L.importCell(ctx(root), 'engine/ai', sidecarFile(root, legacy(head)), {});
  L.acceptFinding(ctx(root), 'engine/ai', 'F17', { reason: 'exporter output is reviewed by an analyst', days: 30 });
  let eff = L.evaluate(ctx(root)).cells.find((c) => c.id === 'engine/ai').findings.find((f) => f.id === 'F17');
  assert.equal(eff.eff, 'accepted');
  write('apps/engine/app/exporters/rfp.py', 'def export():\n    return 44\n');
  eff = L.evaluate(ctx(root)).cells.find((c) => c.id === 'engine/ai').findings.find((f) => f.id === 'F17');
  assert.equal(eff.lapse, 'file-changed');

  L.acceptFinding(ctx(root), 'engine/ai', 'F20', { reason: 'attested by the owner', days: 30 });
  assert.equal(ctx(root).readCell('engine/ai').findings.F20.accepted.file_hash, null, 'nothing to bind to');
  const st = L.evaluate(ctx(root)).cells.find((c) => c.id === 'engine/ai').findings.find((f) => f.id === 'F20');
  assert.equal(st.eff, 'accepted', 'a finding with no file lapses only by date');
});

test('an acceptance on a multi-location finding lapses when ANY of its files changes', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head, put: write } = project();
  const sc = legacy(head);
  sc.findings = [{ id: 'M1', sev: 'High', title: 'Spread over two files', where: ['providers/llm.py:3', 'exporters/rfp.py:1'] }];
  L.importCell(ctx(root), 'engine/ai', sidecarFile(root, sc), {});
  L.acceptFinding(ctx(root), 'engine/ai', 'M1', { reason: 'both paths are behind the gateway', days: 30 });
  const effOf = () => L.evaluate(ctx(root)).cells.find((c) => c.id === 'engine/ai').findings[0];
  assert.equal(effOf().eff, 'accepted');
  write('apps/engine/app/exporters/rfp.py', 'def export():\n    return 77\n');
  assert.equal(effOf().lapse, 'file-changed', 'the SECONDARY file changed, the primary one did not');
});

test('a standard-format sidecar can be imported too, with a review date from the past', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project();
  const side = sidecarFile(root, {
    schema: 1, cell: 'api/backend', date: '2026-11-01', base_commit: head, verdict: 'SHIP WITH FIXES', depth: 'quick',
    findings: [{ id: 'api-backend-001', severity: 'Medium', title: 'Verbose error', file: 'apps/api/app/main.py', line: 2, scenario: 'A bad input echoes the stack trace.' }],
  });
  const r = L.importCell(ctx(root), 'api/backend', side, {});
  assert.equal(r.verdict, 'SHIP WITH FIXES');
  assert.equal(r.imported.legacy, false);
  assert.equal(ctx(root).readCell('api/backend').reviewed_at, '2026-11-01');
});

test('importing a sidecar whose findings fail validation records nothing', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project();
  const side = sidecarFile(root, { schema: 1, date: '2026-11-01', base_commit: head, findings: [{ id: 'x y', severity: 'High', title: 't', file: 'a', scenario: 's' }] });
  assert.throws(() => L.importCell(ctx(root), 'api/backend', side, {}), /id must match/);
  assert.equal(ctx(root).readCell('api/backend'), null);
});

// ------------------------------------------------------------------ CLI

test('cli: import prints a summary, writes security-progress.md, and --json is parseable', (t) => {
  if (!HAVE_GIT) return t.skip('git not installed');
  const { root, head } = project();
  const side = sidecarFile(root, legacy(head));
  const run = (...a) => spawnSync(process.execPath, [LEDGER_PATH, ...a, '--root', root, '--ruleset', 'T1'], { encoding: 'utf8' });
  const text = run('import', 'engine/ai', side);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /imported engine\/ai: BLOCK - open C1 H1 M1 L1 - 4 findings, 2 with no file/);
  assert.match(text.stdout, /reviewed 2026-11-05 at /);
  assert.match(fs.readFileSync(path.join(root, 'reviews', 'security-progress.md'), 'utf8'), /\| F12 \| engine\/ai \| Critical \| apps\/engine\/app\/providers\/llm\.py:3 \(\+2 more\)/);
  const again = run('import', 'engine/ai', side);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already has a recorded review/);
  assert.equal(run('import', 'engine/ai').status, 2, 'needs a sidecar');
  assert.match(run('help').stdout, /import <cell> <sidecar>/);
});

test('cli: --assume-unchanged and --reviewed-ruleset are honoured', () => {
  const { root } = project({ git: false });
  const side = sidecarFile(root, legacy(undefined));
  const run = (...a) => spawnSync(process.execPath, [LEDGER_PATH, ...a, '--root', root, '--ruleset', 'T1'], { encoding: 'utf8' });
  assert.equal(run('import', 'engine/ai', side).status, 2);
  const ok = run('import', 'engine/ai', side, '--assume-unchanged', '--reviewed-ruleset', '0.8.0');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ctx(root).readCell('engine/ai').ruleset, '0.8.0');
});
