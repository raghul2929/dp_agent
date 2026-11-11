// Pending-state tests for skills/dp-security/ledger.mjs. Run from the plugin root:
//   node --test tests/ledger-pending.test.mjs
// `begin` leaves a snapshot; an orchestrator may also leave a brief beside it. `record` clears both,
// and an interrupted run (snapshot but no record) is shown as RESUME in the plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../skills/dp-security/ledger.mjs';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpsec-pending-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/app.py'), 'x = 1\n');
  fs.mkdirSync(path.join(root, 'reviews/.ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reviews/.ledger/registry.json'), JSON.stringify({ schema: 1, modules: { app: { layers: { backend: ['src/**'] } } } }));
  return root;
}
const ctx = (root) => L.loadContext(root, { ruleset: 'T1' });
const pendingDir = (root) => path.join(root, 'reviews/.ledger/pending');

test('record clears the begin snapshot and the brief file written beside it', () => {
  const root = project();
  L.beginCell(ctx(root), 'app/backend');
  fs.writeFileSync(path.join(pendingDir(root), 'app__backend.brief.json'), '{}');
  assert.deepEqual(fs.readdirSync(pendingDir(root)).sort(), ['app__backend.brief.json', 'app__backend.json']);
  L.recordCell(ctx(root), 'app/backend', {}, {});
  assert.deepEqual(fs.readdirSync(pendingDir(root)), []);
});

test('an interrupted run shows as RESUME in the plan, and clears once recorded', () => {
  const root = project();
  L.beginCell(ctx(root), 'app/backend');
  const c = ctx(root);
  const plan = L.buildPlan(c, L.evaluate(c), {});
  const item = plan.work.find((w) => w.id === 'app/backend');
  assert.ok(item.resume, 'a snapshot with no record means the earlier run never finished');
  L.recordCell(ctx(root), 'app/backend', {}, {});
  fs.writeFileSync(path.join(root, 'src/app.py'), 'x = 2\n');
  const c2 = ctx(root);
  assert.equal(L.buildPlan(c2, L.evaluate(c2), {}).work[0].resume, null);
});
