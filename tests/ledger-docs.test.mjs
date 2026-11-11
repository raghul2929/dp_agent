// Doc-drift tests for skills/dp-security. Run from the plugin root:
//   node --test tests/ledger-docs.test.mjs
// The skill and its references promise commands, flags, a registry example and a sidecar schema.
// These tests run those promises through the real code, so a doc that drifts fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../skills/dp-security/ledger.mjs';

const DIR = new URL('./', new URL('../skills/dp-security/ledger.mjs', import.meta.url));
const read = (rel) => fs.readFileSync(new URL(rel, DIR), 'utf8');
const SKILL = read('SKILL.md');
const REGISTRY_MD = read('references/registry.md');
const ORCH_MD = read('references/orchestrated-mode.md');

function jsonBlockAfter(md, heading) {
  const at = md.indexOf(heading);
  assert.ok(at >= 0, `heading not found: ${heading}`);
  const m = /```json\n([\s\S]*?)```/.exec(md.slice(at));
  assert.ok(m, `no json block after: ${heading}`);
  return JSON.parse(m[1]);
}

const helpText = () => {
  const lines = [];
  L.main(['help'], (s) => lines.push(s));
  return lines.join('\n');
};

test('the hybrid registry example in registry.md is valid and has the 8 cells it claims', () => {
  const reg = jsonBlockAfter(REGISTRY_MD, '## Example: a hybrid project');
  assert.deepEqual(L.validateRegistry(reg).errors, []);
  const layers = Object.values(reg.modules).flatMap((m) => Object.keys(m.layers));
  assert.equal(layers.length, 8);
  assert.equal(L.trackOf(reg.modules.assistant), 'hybrid');
  assert.equal(L.trackOf(reg.modules.ingestion), 'ai');
  assert.equal(L.trackOf(reg.modules.api), 'normal', 'backend plus database is still a normal module');
  assert.match(REGISTRY_MD, /That is 8 cells plus the dependency cell/);
});

test('the sidecar example in orchestrated-mode.md passes the ledger validator, with its extra fields ignored', () => {
  const sidecar = jsonBlockAfter(ORCH_MD, '## The sidecar');
  const parsed = L.validateFindingsInput(sidecar);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].severity, 'High');
  assert.equal(parsed.findings[0].check.regex, 'render_html\\(answer');
  assert.equal(parsed.resolved[0].id, 'assistant-ai-001');
  assert.ok(sidecar.refuted && sidecar.status === undefined, 'refuted is a documented top-level key the ledger ignores');
});

test('every ledger command the docs mention exists', () => {
  const help = helpText();
  const mentioned = new Set();
  for (const md of [SKILL, REGISTRY_MD, ORCH_MD]) for (const m of md.matchAll(/`ledger ([a-z]+)/g)) mentioned.add(m[1]);
  assert.ok(mentioned.size >= 10, `expected the docs to mention many commands, found ${[...mentioned]}`);
  for (const cmd of mentioned) assert.ok(help.includes(`  ${cmd}`), `docs mention "ledger ${cmd}" but the CLI has no such command`);
});

test('every ledger flag the docs mention exists', () => {
  const help = helpText();
  const foreign = new Set(['version']); // `node --version`
  const flags = new Set();
  for (const md of [SKILL, REGISTRY_MD, ORCH_MD]) for (const m of md.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) flags.add(m[1]);
  for (const f of flags) if (!foreign.has(f)) assert.ok(help.includes(`--${f}`), `docs mention --${f} but the CLI help does not`);
});

test('the scope grammar the skill teaches is accepted by the planner', () => {
  for (const s of ['full', 'normal', 'ai', 'module:assistant', 'module:assistant:backend+ai', 'module:a,module:b:ai']) {
    assert.doesNotThrow(() => L.parseScope(s), s);
  }
  assert.match(SKILL, /module:<name>:<layer>\+<layer>/);
});

test('the skill file has valid front matter and names itself like its folder', () => {
  const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(SKILL);
  assert.ok(fm, 'front matter');
  assert.equal(fm[1], 'dp-security');
  assert.ok(fm[2].length > 100 && fm[2].length < 1200, 'description should explain when to use the skill');
});

test('every reference file the skill points at exists', () => {
  for (const m of SKILL.matchAll(/`(references\/[\w.-]+\.md)`/g)) assert.ok(fs.existsSync(new URL(m[1], DIR)), `${m[1]} is referenced but missing`);
});
