// AI-signal scanner tests for skills/dp-security/ledger.mjs. Run from the plugin root:
//   node --test tests/ledger-ai.test.mjs
// The scanner answers "is there model code that no ai layer covers?" without a model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../skills/dp-security/ledger.mjs';

function project(files, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-ai-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(path.join(root, 'reviews/.ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reviews/.ledger/registry.json'), JSON.stringify(registry));
  return root;
}

const signals = (root) => {
  const ctx = L.loadContext(root, { ruleset: 'T1' });
  return L.aiSignals(ctx, L.evaluate(ctx));
};

const WITH_AI_LAYER = {
  schema: 1,
  modules: {
    api: { layers: { backend: ['services/api/**'] } },
    assistant: { layers: { ai: ['services/assistant/**'] } },
  },
};

test('a model SDK import inside an ai layer is covered; the same import elsewhere is reported', () => {
  const root = project(
    {
      'services/assistant/answer.py': 'import openai\n\ndef answer():\n    pass\n',
      'services/assistant/prompts/system.txt': 'You are helpful.\n',
      'services/api/summarise.py': 'from openai import OpenAI\n',
      'services/api/plain.py': 'def ok():\n    return 1\n',
    },
    WITH_AI_LAYER,
  );
  const s = signals(root);
  assert.equal(s.no_ai_layer, false);
  assert.deepEqual(s.outside_ai_cells.sample, ['services/api/summarise.py']);
  assert.equal(s.ai_files, 3, 'answer.py, the prompt file and summarise.py');
});

test('an AI SDK in a manifest with no ai layer in the registry is flagged', () => {
  const root = project(
    { 'services/api/requirements.txt': 'fastapi==0.110\nopenai==1.30.0\n', 'services/api/main.py': 'x = 1\n' },
    { schema: 1, modules: { api: { layers: { backend: ['services/api/**'] } } } },
  );
  const s = signals(root);
  assert.equal(s.no_ai_layer, true);
  assert.deepEqual(s.sdk_in_manifests, [{ file: 'services/api/requirements.txt', package: 'openai' }]);
});

test('package.json dependencies are read as JSON; "ai" counts only there', () => {
  const root = project(
    {
      'web/package.json': JSON.stringify({ dependencies: { react: '18', '@anthropic-ai/sdk': '1', ai: '3' }, devDependencies: { '@langchain/core': '0.1' } }),
      'py/requirements.txt': '# ai tools for the team\nrequests\n',
    },
    { schema: 1, modules: { web: { layers: { frontend: ['web/**'] } }, py: { layers: { backend: ['py/**'] } } } },
  );
  const pkgs = signals(root).sdk_in_manifests.map((x) => x.package).sort();
  assert.deepEqual(pkgs, ['@anthropic-ai/sdk', '@langchain/core', 'ai']);
});

test('family prefixes match (langchain-*, llama-index-*, @ai-sdk/*); look-alikes do not', () => {
  const root = project(
    {
      'py/requirements.txt': 'langchain-openai==0.1\nllama_index_core\npydantic-ai\nrequests\nmail-parser\naiohttp\n',
      'web/package.json': JSON.stringify({ dependencies: { '@ai-sdk/openai': '1', aiohttp: '1', 'main-ai': '1' } }),
    },
    { schema: 1, modules: { py: { layers: { backend: ['py/**'] } }, web: { layers: { frontend: ['web/**'] } } } },
  );
  const pkgs = signals(root).sdk_in_manifests.map((x) => x.package).sort();
  assert.deepEqual(pkgs, ['@ai-sdk/openai', 'langchain-openai', 'llama_index_core', 'pydantic-ai']);
});

test('lockfiles and test files are not AI signals', () => {
  const root = project(
    {
      'web/package-lock.json': '{"packages":{"node_modules/openai":{}}}',
      'web/package.json': '{"dependencies":{"react":"18"}}',
      'web/src/app.test.ts': "import OpenAI from 'openai';\n",
      'tests/test_llm.py': 'import openai\n',
      'web/src/app.ts': 'export const x = 1;\n',
    },
    { schema: 1, modules: { web: { layers: { frontend: ['web/**'] } } } },
  );
  const s = signals(root);
  assert.equal(s.no_ai_layer, false);
  assert.equal(s.ai_files, 0);
  assert.deepEqual(s.sdk_in_manifests, []);
});

test('JavaScript import, require and dynamic import forms are all recognised', () => {
  const root = project(
    {
      'a/esm.ts': "import OpenAI from 'openai';\n",
      'a/cjs.js': "const { Anthropic } = require('@anthropic-ai/sdk');\n",
      'a/dyn.mjs': "const m = await import('ollama');\n",
      'a/vercel.tsx': 'import { generateText } from "ai";\n',
      'a/none.ts': "import { join } from 'path';\nconst ai = 1;\n",
    },
    { schema: 1, modules: { a: { layers: { backend: ['a/**'] } } } },
  );
  const s = signals(root);
  assert.deepEqual(s.outside_ai_cells.sample.sort(), ['a/cjs.js', 'a/dyn.mjs', 'a/esm.ts', 'a/vercel.tsx']);
});

test('a project with no model code reports nothing', () => {
  const root = project({ 'src/app.py': 'print(1)\n' }, { schema: 1, modules: { app: { layers: { backend: ['src/**'] } } } });
  const s = signals(root);
  assert.equal(s.no_ai_layer, false);
  assert.equal(s.outside_ai_cells.count, 0);
});

test('status --strict fails on coverage gaps; the default check does not', () => {
  const root = project(
    { 'services/api/summarise.py': 'import openai\n', 'ops/Dockerfile': 'FROM python\n' },
    { schema: 1, modules: { api: { layers: { backend: ['services/api/**'] } }, assistant: { layers: { ai: ['services/assistant/**'] } } } },
  );
  const ctx = L.loadContext(root, { ruleset: 'T1' });
  const ev = L.evaluate(ctx);
  for (const c of ev.cells) L.recordCell(L.loadContext(root, { ruleset: 'T1' }), c.id, {}, {});
  const lax = L.buildStatus(L.loadContext(root, { ruleset: 'T1' }), L.evaluate(L.loadContext(root, { ruleset: 'T1' })), {});
  assert.deepEqual(lax.check.problems, [], 'coverage gaps are warnings unless --strict');
  const strict = L.buildStatus(L.loadContext(root, { ruleset: 'T1' }), L.evaluate(L.loadContext(root, { ruleset: 'T1' })), { strict: true });
  const text = strict.check.problems.join('\n');
  assert.match(text, /in no cell, e\.g\. ops\/Dockerfile/);
  assert.match(text, /outside every ai layer.*services\/api\/summarise\.py/);
});

test('status --strict names the missing ai layer when the registry has none at all', () => {
  const root = project(
    { 'services/api/requirements.txt': 'fastapi\nopenai\n', 'services/api/main.py': 'x = 1\n' },
    { schema: 1, modules: { api: { layers: { backend: ['services/api/**'] } } } },
  );
  const fresh = () => L.loadContext(root, { ruleset: 'T1' });
  for (const c of L.evaluate(fresh()).cells) L.recordCell(fresh(), c.id, {}, {});
  const strict = L.buildStatus(fresh(), L.evaluate(fresh()), { strict: true });
  assert.match(strict.check.problems.join('\n'), /AI signals found but the registry has no ai layer/);
  assert.doesNotMatch(strict.check.problems.join('\n'), /outside every ai layer/, 'one message, not two');
  assert.deepEqual(L.buildStatus(fresh(), L.evaluate(fresh()), {}).check.problems, []);
});

test('progress.md names the AI code that no ai layer reads', () => {
  const root = project(
    { 'services/api/summarise.py': 'import openai\n' },
    { schema: 1, modules: { api: { layers: { backend: ['services/api/**'] } } } },
  );
  const ctx = L.loadContext(root, { ruleset: 'T1' });
  const file = L.writeProgress(ctx);
  const md = fs.readFileSync(file, 'utf8');
  assert.match(md, /## AI code outside any ai layer/);
  assert.match(md, /registry has no `ai` layer/);
});
