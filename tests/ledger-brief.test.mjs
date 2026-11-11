// Work-order ("brief") tests for skills/dp-security/ledger.mjs. Run from the plugin root:
//   node --test tests/ledger-brief.test.mjs
// A brief is what a review skill receives for one cell in orchestrated mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../skills/dp-security/ledger.mjs';

const LEDGER_PATH = fileURLToPath(new URL('../skills/dp-security/ledger.mjs', import.meta.url));

const FILES = {
  'services/assistant/app/api.py': 'def ask():\n    return 2\n',
  'services/assistant/llm/answer.py': 'import openai\n\ndef answer(page):\n    return render_html(page)\n',
  'services/assistant/prompts/system.txt': 'You are helpful.\n',
  'packages/shared/index.ts': 'export const add = (a, b) => a + b;\n',
  'package.json': '{"name":"x"}\n',
};
const REGISTRY = {
  schema: 1,
  modules: {
    assistant: {
      layers: { backend: ['services/assistant/app/**'], ai: ['services/assistant/llm/**', 'services/assistant/prompts/**'] },
      depends_on: ['shared-lib'],
    },
    'shared-lib': { layers: { backend: ['packages/shared/**'] } },
  },
};

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-brief-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  for (const [rel, text] of Object.entries(FILES)) put(rel, text);
  put('reviews/.ledger/registry.json', JSON.stringify(REGISTRY));
  return { root, put };
}

const ctx = (root, now) => L.loadContext(root, { now, ruleset: 'T1' });
const brief = (root, id, o = {}, now) => {
  const c = ctx(root, now);
  return L.buildBrief(c, L.evaluate(c), id, o);
};
const rec = (root, id, input = {}, o = {}, now) => L.recordCell(ctx(root, now), id, input, o);
const recordAll = (root) => {
  for (const c of L.evaluate(ctx(root)).cells) rec(root, c.id);
};
const F = (o = {}) => ({
  id: 'assistant-ai-001', severity: 'High', title: 'Page text reaches an HTML sink',
  file: 'services/assistant/llm/answer.py', line: 4, scenario: 'Script tag in page flows through answer() into render_html().', ...o,
});

test('first brief for a never-reviewed cell: full review of every file, siblings listed, first id', () => {
  const { root } = project();
  const b = brief(root, 'assistant/ai');
  assert.equal(b.kind, 'full');
  assert.equal(b.skill, 'dp-ai-review');
  assert.deepEqual(b.files, ['services/assistant/llm/answer.py', 'services/assistant/prompts/system.txt']);
  assert.equal(b.next_id, 'assistant-ai-001');
  assert.deepEqual(b.replay, []);
  assert.equal(b.prior, null);
  assert.deepEqual(b.siblings, [{ id: 'assistant/backend', layer: 'backend', state: 'never', verdict: null }]);
  assert.deepEqual(b.reasons, ['never reviewed']);
});

test('after a fix attempt: diff brief carries the changed files and the full finding to replay', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F(), F({ id: 'assistant-ai-002', severity: 'Low', title: 'Verbose error', file: 'services/assistant/prompts/system.txt', line: 1, scenario: 'Error text names the model.' })] });
  put('services/assistant/llm/answer.py', 'import openai\n\ndef answer(page):\n    return escape(page)\n');
  const b = brief(root, 'assistant/ai');
  assert.equal(b.kind, 'diff');
  assert.deepEqual(b.changed_files, ['services/assistant/llm/answer.py']);
  assert.deepEqual(b.replay.map((f) => f.id), ['assistant-ai-001']);
  assert.match(b.replay[0].scenario, /Script tag/, 'the recorded failure scenario travels with the brief');
  assert.deepEqual(b.carry_forward, ['assistant-ai-002'], 'a finding in an unchanged file is carried, not re-reviewed');
  assert.equal(b.next_id, 'assistant-ai-003');
  assert.equal(b.prior.verdict, 'BLOCK');
  assert.equal(b.siblings[0].state, 'clean');
});

test('an interface brief names the upstream module and what changed in it', () => {
  const { root, put } = project();
  recordAll(root);
  put('packages/shared/index.ts', 'export const add = (a, b) => a - b;\n');
  const b = brief(root, 'assistant/backend');
  assert.equal(b.kind, 'interface');
  assert.deepEqual(b.upstream_changed, [{ module: 'shared-lib', changed_files: ['packages/shared/index.ts'] }]);
  assert.deepEqual(b.changed_files, [], 'the cell own files did not change');
  assert.deepEqual(b.replay, []);
});

test('accepted findings are listed so the reviewer does not re-report them', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F()] });
  L.acceptFinding(ctx(root), 'assistant/ai', 'assistant-ai-001', { reason: 'sink is sandboxed in the widget', days: 30 });
  const b = brief(root, 'assistant/ai', { rerunAll: true });
  assert.equal(b.kind, 'full');
  assert.deepEqual(b.already_accepted.map((f) => f.id), ['assistant-ai-001']);
  assert.deepEqual(b.replay, []);
  put('services/assistant/llm/answer.py', 'changed\n');
  const after = brief(root, 'assistant/ai');
  assert.deepEqual(after.already_accepted, [], 'acceptance lapsed with the file change');
  assert.deepEqual(after.replay.map((f) => f.id), ['assistant-ai-001'], 'so it must be replayed');
});

test('a re-run of a current cell is forced with --rerun-all and replays every open finding', () => {
  const { root } = project();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F()] });
  assert.throws(() => brief(root, 'assistant/ai'), /nothing to review/);
  const b = brief(root, 'assistant/ai', { rerunAll: true, depth: 'deep' });
  assert.equal(b.kind, 'full');
  assert.equal(b.depth, 'deep');
  assert.deepEqual(b.replay.map((f) => f.id), ['assistant-ai-001']);
  assert.deepEqual(b.reasons, ['re-run everything requested']);
});

test('the dependency cell briefs as a dependency audit', () => {
  const { root } = project();
  const b = brief(root, 'project/deps');
  assert.equal(b.kind, 'deps');
  assert.equal(b.skill, 'dp-module-review');
  assert.deepEqual(b.files, ['package.json']);
});

test('finding ids keep counting past resolved ones, so an id is never reused', () => {
  const { root, put } = project();
  recordAll(root);
  rec(root, 'assistant/ai', { findings: [F()] });
  put('services/assistant/llm/answer.py', 'import openai\n\ndef answer(page):\n    return escape(page)\n');
  rec(root, 'assistant/ai', { resolved: [{ id: 'assistant-ai-001', evidence: 'escaped before render_html' }] }, { kind: 'diff' });
  put('services/assistant/prompts/system.txt', 'changed prompt\n');
  assert.equal(brief(root, 'assistant/ai').next_id, 'assistant-ai-002');
});

test('unknown cells are rejected', () => {
  const { root } = project();
  assert.throws(() => brief(root, 'ghost/backend'), /Unknown cell/);
});

test('cli: brief prints JSON a skill can parse, and rejects a bad depth', () => {
  const { root } = project();
  const run = (...args) => spawnSync(process.execPath, [LEDGER_PATH, ...args, '--root', root, '--ruleset', 'T1'], { encoding: 'utf8' });
  const ok = run('brief', 'assistant/ai', '--depth', 'quick');
  assert.equal(ok.status, 0, ok.stderr);
  const b = JSON.parse(ok.stdout);
  assert.equal(b.cell, 'assistant/ai');
  assert.equal(b.depth, 'quick');
  assert.equal(run('brief', 'assistant/ai', '--depth', 'huge').status, 2);
  assert.equal(run('brief').status, 2);
});
