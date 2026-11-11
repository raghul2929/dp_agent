// Tests for model packages that sit outside every ai layer. Run from the plugin root:
//   node --test tests/ledger-ai-manifest.test.mjs
// The case: a project already has an ai layer, and someone installs a model SDK in a DIFFERENT
// module's manifest. That must not stay silent just because some other module is already covered.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../skills/dp-security/ledger.mjs';

function project(files, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-aim-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  fs.mkdirSync(path.join(root, 'reviews/.ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reviews/.ledger/registry.json'), JSON.stringify(registry));
  return root;
}
const fresh = (root) => L.loadContext(root, { ruleset: 'T1' });
const signals = (root) => {
  const c = fresh(root);
  return L.aiSignals(c, L.evaluate(c));
};

const FILES = {
  'apps/engine/requirements.txt': 'openai\nlangchain-core\n',
  'apps/engine/app/graph.py': 'import openai\n',
  'apps/classifier/requirements.txt': 'fastapi\ntransformers\ntorch\n',
  'apps/classifier/app/main.py': 'def run():\n    return 1\n',
};
const REGISTRY = {
  schema: 1,
  modules: {
    engine: { layers: { ai: ['apps/engine/**'] } },
    classifier: { layers: { backend: ['apps/classifier/**'] } },
  },
};

test('a model package in a non-AI module is flagged even though another module has an ai layer', () => {
  const s = signals(project(FILES, REGISTRY));
  assert.equal(s.no_ai_layer, false, 'the registry does have an ai layer');
  assert.equal(s.outside_ai_cells.count, 0, 'no source file imports a model SDK outside it');
  assert.deepEqual(s.sdk_outside_ai_cells, { count: 1, sample: [{ file: 'apps/classifier/requirements.txt', packages: ['torch', 'transformers'] }] });
});

test('the same packages inside an ai layer are covered and not flagged', () => {
  const reg = structuredClone(REGISTRY);
  reg.modules.classifier.layers.ai = ['apps/classifier/**'];
  assert.equal(signals(project(FILES, reg)).sdk_outside_ai_cells.count, 0);
});

test('several packages in one manifest count once, and each manifest is listed', () => {
  const files = { ...FILES, 'apps/other/requirements.txt': 'anthropic\n', 'apps/other/main.py': 'x = 1\n' };
  const reg = structuredClone(REGISTRY);
  reg.modules.other = { layers: { backend: ['apps/other/**'] } };
  const s = signals(project(files, reg));
  assert.equal(s.sdk_outside_ai_cells.count, 2);
  assert.deepEqual(s.sdk_outside_ai_cells.sample.map((x) => x.file), ['apps/classifier/requirements.txt', 'apps/other/requirements.txt']);
});

test('a project with no model package outside an ai layer reports nothing', () => {
  const files = { 'apps/engine/requirements.txt': 'openai\n', 'apps/engine/app/g.py': 'import openai\n', 'apps/api/requirements.txt': 'fastapi\n', 'apps/api/main.py': 'x=1\n' };
  const reg = { schema: 1, modules: { engine: { layers: { ai: ['apps/engine/**'] } }, api: { layers: { backend: ['apps/api/**'] } } } };
  const s = signals(project(files, reg));
  assert.equal(s.sdk_outside_ai_cells.count, 0);
  assert.deepEqual(L.buildStatus(fresh(project(files, reg)), L.evaluate(fresh(project(files, reg))), { strict: true }).check.problems.filter((p) => /model packages/.test(p)), []);
});

test('the plan, the strict check and progress.md all name the uncovered manifest', () => {
  const root = project(FILES, REGISTRY);
  const c = fresh(root);
  const ev = L.evaluate(c);
  for (const cell of ev.cells) L.recordCell(fresh(root), cell.id, {}, {});
  const c2 = fresh(root);
  const ev2 = L.evaluate(c2);

  const lax = L.buildStatus(c2, ev2, {});
  assert.deepEqual(lax.check.problems, [], 'a coverage gap is a warning unless --strict');
  const strict = L.buildStatus(c2, L.evaluate(c2), { strict: true });
  assert.match(strict.check.problems.join('\n'), /model packages in apps\/classifier\/requirements\.txt \(torch, transformers\) sit outside every ai layer/);

  const md = fs.readFileSync(L.writeProgress(fresh(root)), 'utf8');
  assert.match(md, /## Model packages outside any ai layer/);
  assert.match(md, /`apps\/classifier\/requirements\.txt` \(torch, transformers\)/);
});

test('cli: coverage prints the model packages outside any ai layer', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = project(FILES, REGISTRY);
  const ledger = fileURLToPath(new URL('../skills/dp-security/ledger.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [ledger, 'coverage', '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Model packages outside any ai layer: apps\/classifier\/requirements\.txt \(torch, transformers\)/);
});
