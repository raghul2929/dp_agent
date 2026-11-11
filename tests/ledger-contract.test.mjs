// Contract tests between skills/dp-security and the two review skills. Run from the plugin root:
//   node --test tests/ledger-contract.test.mjs
// The orchestrated-mode contract lives in three places: the code that emits the brief, the doc
// that describes it, and the review skills that obey it. These tests fail when they drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../skills/dp-security/ledger.mjs';

const SKILLS = new URL('../skills/', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, SKILLS), 'utf8');
const CONTRACT = read('dp-security/references/orchestrated-mode.md');

test('both review skills point at the contract, and the file they point at exists', () => {
  for (const skill of ['dp-module-review', 'dp-ai-review']) {
    const md = read(`${skill}/SKILL.md`);
    assert.match(md, /## Orchestrated mode/, `${skill} needs an Orchestrated mode section`);
    const ref = /`(\.\.\/dp-security\/references\/orchestrated-mode\.md)`/.exec(md);
    assert.ok(ref, `${skill} must reference ../dp-security/references/orchestrated-mode.md`);
    assert.ok(fs.existsSync(new URL(`${skill}/${ref[1]}`, SKILLS)), `${skill}: ${ref[1]} does not resolve from the skill folder`);
    assert.match(md, /Do not run `begin` or `record` yourself/, `${skill} must leave the ledger to the orchestrator`);
    assert.match(md, /orchestrated-mode\.md`[^\n]{0,20}section \*The sidecar\*/, `${skill} Step 9 must name the sidecar schema`);
  }
});

test('the dp-ai-review pointer skips the module-review offer and records siblings as Delegated', () => {
  assert.match(read('dp-ai-review/SKILL.md'), /Step 11's offer to run `dp-module-review` is skipped/);
});

test('every field the brief command emits is documented in the contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-contract-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/app.py'), 'x = 1\n');
  fs.mkdirSync(path.join(root, 'reviews/.ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reviews/.ledger/registry.json'), JSON.stringify({ schema: 1, modules: { app: { layers: { backend: ['src/**'] } } } }));
  const ctx = L.loadContext(root, { ruleset: 'T1' });
  const brief = L.buildBrief(ctx, L.evaluate(ctx), 'app/backend');
  for (const key of Object.keys(brief)) assert.ok(CONTRACT.includes(`\`${key}\``), `the brief emits "${key}" but orchestrated-mode.md does not document it`);
});

test('every finding field the ledger stores for a reviewer to write is documented', () => {
  const documented = ['id', 'severity', 'file', 'line', 'scenario', 'fix', 'check', 'status', 'baseline', 'also'];
  const parsed = L.validateFindingsInput({
    findings: [{ id: 'a-1', severity: 'High', title: 't', file: 'f.py', also: ['g.py'], line: 3, scenario: 's', fix: 'x', check: { regex: 'a' }, status: 'CONFIRMED', baseline: false }],
  }).findings[0];
  for (const f of documented) assert.ok(f in parsed, `the validator does not carry "${f}"`);
  for (const f of documented) assert.ok(CONTRACT.includes(`\`${f}\``), `orchestrated-mode.md does not document the finding field "${f}"`);
});
