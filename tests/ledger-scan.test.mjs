// First-read scan tests for skills/dp-security/ledger.mjs. Run from the plugin root:
//   node --test tests/ledger-scan.test.mjs
// `scan` works before any registry exists: manifests, top-level layout, AI signals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../skills/dp-security/ledger.mjs';

const LEDGER_PATH = fileURLToPath(new URL('../skills/dp-security/ledger.mjs', import.meta.url));

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-scan-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const HYBRID = {
  'apps/web/package.json': '{"dependencies":{"react":"18"}}',
  'apps/web/package-lock.json': '{}',
  'apps/web/src/App.tsx': 'export const App = () => null;\n',
  'apps/web/src/index.tsx': 'import { App } from "./App";\n',
  'services/api/requirements.txt': 'fastapi\nopenai\n',
  'services/api/main.py': 'import openai\n',
  'node_modules/dep/index.js': 'module.exports = 1;\n',
  'README.md': '# x\n',
};

test('scan reads a project with no registry: manifests, layout and AI signals', () => {
  const root = project(HYBRID);
  const s = L.scanProject(root);
  assert.deepEqual(s.manifests, ['apps/web/package.json', 'services/api/requirements.txt'], 'lockfiles are not manifests to read');
  assert.deepEqual(s.top_level, [
    { name: 'apps/', files: 4 },
    { name: 'services/', files: 2 },
    { name: '(files at the root)', files: 1 },
  ]);
  assert.equal(s.git, false);
  assert.equal(s.file_count, 7, 'node_modules is skipped');
  assert.equal(s.ai.no_ai_layer, true, 'there is no registry, so no ai layer yet');
  assert.deepEqual(s.ai.sdk_in_manifests, [{ file: 'services/api/requirements.txt', package: 'openai' }]);
  assert.deepEqual(s.ai.outside_ai_cells.sample, ['services/api/main.py']);
});

test('scan of a project with no model code says so', () => {
  const s = L.scanProject(project({ 'src/app.py': 'print(1)\n', 'pyproject.toml': '[project]\nname = "x"\n' }));
  assert.equal(s.ai.no_ai_layer, false);
  assert.equal(s.ai.ai_files, 0);
  assert.deepEqual(s.ai.sdk_in_manifests, []);
  assert.deepEqual(s.manifests, ['pyproject.toml']);
});

test('scan never counts the reviews folder', () => {
  const root = project({ 'src/a.py': 'x=1\n', 'reviews/progress.md': '# p\n', 'reviews/.ledger/registry.json': '{}' });
  assert.equal(L.scanProject(root).file_count, 1);
});

test('cli: scan works with no registry and prints JSON on request', () => {
  const root = project(HYBRID);
  const run = (...a) => spawnSync(process.execPath, [LEDGER_PATH, 'scan', ...a, '--root', root], { encoding: 'utf8' });
  const text = run();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Manifests: apps\/web\/package\.json, services\/api\/requirements\.txt/);
  assert.match(text.stdout, /AI signals: openai/);
  const json = JSON.parse(run('--json').stdout);
  assert.equal(json.file_count, 7);
  const plan = spawnSync(process.execPath, [LEDGER_PATH, 'plan', '--root', root], { encoding: 'utf8' });
  assert.equal(plan.status, 2, 'every other command still needs a registry');
});
