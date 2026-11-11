#!/usr/bin/env node
// ledger.mjs - progress ledger and planner for /dp-security.
//
// Decides which (module, layer) "cells" need a security review, records what each
// review found, and renders reviews/security-progress.md. It is deterministic on purpose: it only
// hashes files and compares. A model deciding "this looks unchanged" would sometimes be
// wrong, and a wrong skip is a missed vulnerability.
//
// No external deps. Node >= 18. Works without git history (zip-drop projects).
//
// Layout, all under <root>/reviews/ :
//   .ledger/registry.json        modules, layers (globs), depends_on      (written by the skill)
//   .ledger/cells/<m>__<l>.json  one file per cell: fingerprint, findings (written by `record`)
//   .ledger/pending/<m>__<l>.json snapshot taken by `begin`, consumed by `record`
//   security-progress.md         generated view; never hand-edited
//
// One file per cell keeps merge conflicts rare when the ledger is committed.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 1;
export const LAYERS = ['frontend', 'backend', 'database', 'ai', 'infra'];
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const KINDS = ['full', 'diff', 'interface', 'deps'];
const DEPS_ID = 'project/deps';
const DEFAULT_TTL_DAYS = 14;
const DEFAULT_ACCEPT_DAYS = 90;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Lockfiles are generated and noisy. They belong to the dependency cell, not to a
// module cell, so bumping a transitive version does not re-queue a whole module.
const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'poetry.lock', 'Pipfile.lock', 'uv.lock',
]);
const MANIFEST_GLOBS = [
  '**/package.json', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/yarn.lock',
  '**/pnpm-lock.yaml', '**/bun.lockb', '**/requirements*.txt', '**/pyproject.toml',
  '**/poetry.lock', '**/Pipfile', '**/Pipfile.lock', '**/uv.lock', '**/setup.py', '**/setup.cfg',
];
// Directories skipped only when there is no git to honour .gitignore.
const WALK_SKIP = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.ruff_cache', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', 'target', 'coverage',
  '.cache', '.idea', '.vscode', '.gradle',
]);
// "Uncovered" only reports files that look like code or config, not docs and images.
const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'go', 'java', 'kt', 'cs', 'rb',
  'php', 'rs', 'sql', 'sh', 'ps1', 'bat', 'yml', 'yaml', 'json', 'toml', 'ini', 'cfg', 'env',
  'tf', 'tfvars', 'html', 'prisma', 'graphql', 'proto',
]);
const CODE_NAMES = /^(Dockerfile|Makefile|docker-compose.*|\.env(\..*)?)$/;

export class LedgerError extends Error {
  constructor(msg, code = 2) {
    super(msg);
    this.exitCode = code;
  }
}

// ------------------------------------------------------------------ small utils

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
const posix = (p) => p.split(path.sep).join('/');
const baseName = (f) => f.slice(f.lastIndexOf('/') + 1);
const rank = (v) => ({ SHIP: 0, 'SHIP WITH FIXES': 1, BLOCK: 2 })[v] ?? -1;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}
export const stableStringify = (v) => JSON.stringify(sortKeys(v), null, 2) + '\n';

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, stableStringify(obj));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new LedgerError(`Cannot read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new LedgerError(`${file} is not valid JSON: ${e.message}`);
  }
}

const isoDate = (d) => d.toISOString().slice(0, 10);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// ------------------------------------------------------------------ globs
// Supported: **  *  ?  {a,b}  a leading ! (exclude)  and a plain path = that path or anything under it.
// Patterns are not anchored like .gitignore: write `**/*.py`, not `*.py`, to match nested files.

export function globToRegExp(glob) {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; ) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 2;
        if (glob[i] === '/') {
          re += '(?:.*/)?';
          i++;
        } else re += '.*';
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      re += '(?:';
      depth++;
      i++;
    } else if (c === '}' && depth) {
      re += ')';
      depth--;
      i++;
    } else if (c === ',' && depth) {
      re += '|';
      i++;
    } else {
      re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

function compileOne(p) {
  p = p.replace(/^\.\//, '');
  if (!/[*?{]/.test(p)) {
    const base = p.replace(/\/+$/, '');
    return (f) => f === base || f.startsWith(base + '/');
  }
  const re = globToRegExp(p.endsWith('/') ? p + '**' : p);
  return (f) => re.test(f);
}

export function matcher(patterns) {
  const inc = [];
  const exc = [];
  for (const p of patterns) (p.startsWith('!') ? exc : inc).push(compileOne(p.startsWith('!') ? p.slice(1) : p));
  return (f) => inc.some((t) => t(f)) && !exc.some((t) => t(f));
}

// ------------------------------------------------------------------ files and hashing

function gitFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 512 * 1024 * 1024,
    });
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch {
    return null; // not a git repo, or git is not installed
  }
}

function walk(root) {
  const out = [];
  const rec = (dir, rel) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) rec(path.join(dir, e.name), r);
      } else if (e.isFile() || e.isSymbolicLink()) out.push(r);
    }
  };
  rec(root, '');
  return out;
}

// Git mode honours .gitignore exactly. Without git, a default skip list applies.
export function listFiles(root, ignoreGlobs = []) {
  const files = gitFiles(root) ?? walk(root);
  const ignored = ignoreGlobs.length ? matcher(ignoreGlobs) : () => false;
  return [...new Set(files)]
    .filter((f) => !f.startsWith('reviews/') && !f.startsWith('.git/') && !f.split('/').includes('node_modules') && !ignored(f))
    .sort();
}

function normalizeText(buf) {
  let start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0; // BOM
  if (buf.indexOf(0x0d) === -1 && start === 0) return buf;
  const out = Buffer.allocUnsafe(buf.length - start);
  let n = 0;
  for (let i = start; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue; // CRLF -> LF
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
}

// Text files are hashed with line endings normalised so a CRLF checkout on one machine and
// an LF checkout on another do not make every cell look changed. Binary files hash raw bytes.
export function hashFile(abs) {
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) return sha('symlink:' + fs.readlinkSync(abs));
  if (!st.isFile()) return null;
  if (st.size > MAX_FILE_BYTES) {
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(abs, 'r');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    try {
      for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0; ) h.update(chunk.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
    return h.digest('hex').slice(0, 32);
  }
  const buf = fs.readFileSync(abs);
  const probe = buf.subarray(0, 8000);
  return sha(probe.indexOf(0) === -1 ? normalizeText(buf) : buf);
}

function makeHasher(root) {
  const cache = new Map();
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let h = null;
    try {
      h = hashFile(path.join(root, rel));
    } catch {
      h = null; // deleted since listing, or unreadable
    }
    cache.set(rel, h);
    return h;
  };
}

function snapshotFiles(ctx, files) {
  const map = {};
  for (const f of files) {
    const h = ctx.hashOf(f);
    if (h) map[f] = h;
  }
  const fingerprint = 'sha256:' + sha(Object.keys(map).sort().map((f) => `${f}\0${map[f]}`).join('\n'));
  return { files: map, fingerprint };
}

function diffFiles(prev = {}, cur = {}) {
  const added = [];
  const modified = [];
  const removed = [];
  for (const f of Object.keys(cur)) {
    if (!(f in prev)) added.push(f);
    else if (prev[f] !== cur[f]) modified.push(f);
  }
  for (const f of Object.keys(prev)) if (!(f in cur)) removed.push(f);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

// ------------------------------------------------------------------ registry

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function trackOf(def) {
  const layers = Object.keys(def.layers);
  const ai = layers.includes('ai');
  if (ai && layers.length > 1) return 'hybrid';
  return ai ? 'ai' : 'normal';
}

export function validateRegistry(reg) {
  const errors = [];
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) return { errors: ['registry must be a JSON object'] };
  if (reg.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  const mods = reg.modules;
  if (!mods || typeof mods !== 'object' || !Object.keys(mods).length) errors.push('modules must be a non-empty object');
  else {
    for (const [name, def] of Object.entries(mods)) {
      if (!NAME_RE.test(name)) errors.push(`module "${name}": name must match ${NAME_RE}`);
      if (name === 'project') errors.push('module "project": name is reserved for the dependency cell');
      if (!def || typeof def.layers !== 'object' || !def.layers || !Object.keys(def.layers).length) {
        errors.push(`module "${name}": layers must be a non-empty object`);
        continue;
      }
      for (const [layer, globs] of Object.entries(def.layers)) {
        if (!LAYERS.includes(layer)) errors.push(`module "${name}": unknown layer "${layer}" (use ${LAYERS.join(', ')})`);
        if (!Array.isArray(globs) || !globs.length || globs.some((g) => typeof g !== 'string' || !g.trim())) {
          errors.push(`module "${name}" layer "${layer}": globs must be a non-empty array of strings`);
          continue;
        }
        for (const g of globs) {
          const b = g.replace(/^!/, '');
          if (path.isAbsolute(b) || b.split('/').includes('..') || b.includes('\\')) {
            errors.push(`module "${name}" layer "${layer}": glob "${g}" must be relative, use "/", and stay inside the project`);
          }
        }
      }
      const deps = def.depends_on ?? [];
      if (!Array.isArray(deps)) errors.push(`module "${name}": depends_on must be an array`);
      else {
        for (const d of deps) {
          if (d === name) errors.push(`module "${name}": cannot depend on itself`);
          else if (!mods[d]) errors.push(`module "${name}": depends_on "${d}" is not a module`);
        }
      }
    }
  }
  if (reg.ignore !== undefined && (!Array.isArray(reg.ignore) || reg.ignore.some((g) => typeof g !== 'string'))) {
    errors.push('ignore must be an array of glob strings');
  }
  const ttl = reg.settings?.ttl_days;
  if (ttl !== undefined && !(Number.isInteger(ttl) && ttl > 0)) errors.push('settings.ttl_days must be a positive integer');
  return { errors };
}

function topoOrder(registry) {
  const names = Object.keys(registry.modules).sort();
  const indeg = new Map(names.map((n) => [n, 0]));
  const rev = new Map(names.map((n) => [n, []]));
  for (const n of names) {
    for (const d of new Set(registry.modules[n].depends_on ?? [])) {
      indeg.set(n, indeg.get(n) + 1);
      rev.get(d).push(n);
    }
  }
  const ready = names.filter((n) => indeg.get(n) === 0);
  const order = [];
  while (ready.length) {
    const n = ready.shift();
    order.push(n);
    for (const m of rev.get(n)) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) {
        ready.push(m);
        ready.sort();
      }
    }
  }
  const cyclic = names.filter((n) => !order.includes(n));
  return { order: [...order, ...cyclic], cyclic };
}

// ------------------------------------------------------------------ context

function pluginVersion() {
  try {
    const p = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude-plugin', 'plugin.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const cellFile = (id) => id.replace('/', '__') + '.json';

export function loadContext(rootArg, opts = {}) {
  const root = path.resolve(rootArg);
  const dir = path.join(root, 'reviews', '.ledger');
  const registry = readJson(path.join(dir, 'registry.json'));
  if (!registry) throw new LedgerError(`No registry at reviews/.ledger/registry.json (root: ${root}). Create one with: ledger.mjs registry set <file>`);
  const { errors } = validateRegistry(registry);
  if (errors.length) throw new LedgerError('Invalid registry:\n  ' + errors.join('\n  '));
  if (opts.now && !validDate(opts.now)) throw new LedgerError(`--now must be YYYY-MM-DD, got "${opts.now}"`);
  const now = opts.now ? new Date(opts.now + 'T00:00:00Z') : new Date();
  const files = listFiles(root, registry.ignore ?? []);
  return {
    root,
    dir,
    registry,
    files,
    now,
    today: isoDate(now),
    ruleset: opts.ruleset ?? pluginVersion(),
    ttlDays: registry.settings?.ttl_days ?? DEFAULT_TTL_DAYS,
    manifests: [...MANIFEST_GLOBS, ...(registry.settings?.manifests ?? [])],
    hashOf: makeHasher(root),
    readCell: (id) => readJson(path.join(dir, 'cells', cellFile(id))),
    writeCell: (rec) => writeJson(path.join(dir, 'cells', cellFile(rec.id)), rec),
    readPending: (id) => readJson(path.join(dir, 'pending', cellFile(id))),
    writePending: (id, snap) => writeJson(path.join(dir, 'pending', cellFile(id)), snap),
    // The snapshot from `begin`, and the brief file the orchestrator may have written beside it.
    clearPending: (id) => {
      fs.rmSync(path.join(dir, 'pending', cellFile(id)), { force: true });
      fs.rmSync(path.join(dir, 'pending', cellFile(id).replace(/\.json$/, '.brief.json')), { force: true });
    },
    cellRecordIds: () => {
      try {
        return fs.readdirSync(path.join(dir, 'cells')).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, 'cells', f))?.id).filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

export function cellDefs(ctx) {
  const defs = [{ id: DEPS_ID, module: 'project', layer: 'deps', skill: 'dp-module-review', files: ctx.files.filter(matcher(ctx.manifests)) }];
  for (const name of topoOrder(ctx.registry).order) {
    const def = ctx.registry.modules[name];
    for (const layer of LAYERS) {
      const globs = def.layers[layer];
      if (!globs) continue;
      const m = matcher(globs);
      defs.push({
        id: `${name}/${layer}`,
        module: name,
        layer,
        skill: layer === 'ai' ? 'dp-ai-review' : 'dp-module-review',
        files: ctx.files.filter((f) => m(f) && !LOCKFILES.has(baseName(f))),
      });
    }
  }
  return defs;
}

// ------------------------------------------------------------------ findings

// A finding may live in several files (`also`). A change to ANY of them counts as a change to
// the finding. One location hashes as the file itself, so records written for a single file
// keep matching. A finding with no location (an imported evidence gap) never lapses by file.
const locsOf = (f) => [f.file, ...(f.also ?? [])].filter(Boolean);
const locHash = (hashOf, f) => {
  const locs = locsOf(f);
  if (!locs.length) return null;
  if (locs.length === 1) return hashOf(locs[0]);
  return sha(locs.map((p) => `${p}\0${hashOf(p) ?? ''}`).join('\n'));
};
const touches = (changed, f) => !!changed && locsOf(f).some((p) => changed.modified.includes(p) || changed.removed.includes(p));

function lapseReason(f, hashOf, today) {
  if (f.state !== 'accepted') return null;
  const a = f.accepted ?? {};
  if (a.expires && a.expires < today) return 'expired';
  if (a.file_hash && locsOf(f).length && locHash(hashOf, f) !== a.file_hash) return 'file-changed';
  return null;
}

// A finding counts as open unless it is accepted AND the acceptance still holds:
// not expired, and the file it was accepted against has not changed since.
export function effectiveFindings(findings, hashOf, today) {
  return Object.values(findings ?? {})
    .map((f) => {
      const lapse = lapseReason(f, hashOf, today);
      return { ...f, eff: f.state === 'accepted' && !lapse ? 'accepted' : 'open', lapse };
    })
    .sort(byId);
}

// Same rule as dp-module-review / dp-ai-review: Critical or High -> BLOCK; Medium/Low or an
// accepted High -> SHIP WITH FIXES; incomplete review caps at SHIP WITH FIXES.
export function cellVerdict(rec, eff) {
  const open = eff.filter((f) => f.eff === 'open');
  let v = 'SHIP';
  if (open.some((f) => f.severity === 'Critical' || f.severity === 'High') || rec.block_rule) v = 'BLOCK';
  else if (open.length || eff.some((f) => f.eff === 'accepted' && f.severity === 'High')) v = 'SHIP WITH FIXES';
  else if (rec.complete === false) v = 'SHIP WITH FIXES';
  return v;
}

const countBySeverity = (eff) => {
  const c = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const f of eff) if (f.eff === 'open') c[f.severity]++;
  return c;
};

// ------------------------------------------------------------------ evaluation

export function evaluate(ctx) {
  const defs = cellDefs(ctx);
  const snaps = new Map(defs.map((d) => [d.id, snapshotFiles(ctx, d.files)]));
  const modFp = {};
  for (const name of Object.keys(ctx.registry.modules)) {
    modFp[name] = sha(defs.filter((d) => d.module === name).map((d) => `${d.id}:${snaps.get(d.id).fingerprint}`).sort().join('\n'));
  }
  const cells = defs.map((d, i) => {
    const deps = d.module === 'project' ? [] : [...new Set(ctx.registry.modules[d.module].depends_on ?? [])].sort();
    return evalCell(ctx, d, snaps.get(d.id), ctx.readCell(d.id), Object.fromEntries(deps.map((m) => [m, modFp[m]])), i);
  });
  const known = new Set(defs.map((d) => d.id));
  const orphans = ctx.cellRecordIds().filter((id) => !known.has(id)).sort();
  return { cells, modFp, orphans };
}

function evalCell(ctx, d, snap, rec, upstreamNow, order) {
  const c = {
    id: d.id, module: d.module, layer: d.layer, skill: d.skill, order,
    fingerprint: snap.fingerprint, files: snap.files, fileCount: Object.keys(snap.files).length,
    upstreamNow, record: rec, reasons: [], changed: null, replay: [], findings: [], verdict: null,
  };
  if (!rec) {
    c.state = 'never';
    c.reasons.push({ type: 'never' });
    c.action = d.layer === 'deps' ? 'deps-audit' : 'review-full';
    c.cost = d.layer === 'deps' ? 'script' : 'full';
    return c;
  }
  const hashOf = (f) => snap.files[f] ?? ctx.hashOf(f);
  c.findings = effectiveFindings(rec.findings, hashOf, ctx.today);
  c.verdict = cellVerdict(rec, c.findings);
  if (rec.complete === false) c.reasons.push({ type: 'incomplete' });
  if (rec.fingerprint !== snap.fingerprint) {
    c.changed = diffFiles(rec.files, snap.files);
    c.reasons.push({ type: d.layer === 'deps' ? 'manifests' : 'own-files', ...c.changed });
  }
  for (const [m, fp] of Object.entries(upstreamNow)) {
    if (rec.upstream?.[m] !== fp) c.reasons.push({ type: 'upstream', module: m, newDependency: !rec.upstream || !(m in rec.upstream) });
  }
  if (d.layer === 'deps') {
    const age = daysBetween(rec.reviewed_at, ctx.today);
    if (age >= ctx.ttlDays) c.reasons.push({ type: 'ttl', days: age });
  }
  if (!c.reasons.length) {
    c.state = c.findings.some((f) => f.eff === 'open') ? 'open' : c.findings.some((f) => f.eff === 'accepted') ? 'accepted' : 'clean';
    return c;
  }
  c.state = 'stale';
  const own = c.reasons.some((r) => r.type === 'own-files');
  if (d.layer === 'deps') {
    c.action = 'deps-audit';
    c.cost = 'script';
  } else if (c.reasons.some((r) => r.type === 'incomplete') || (own && !rec.files)) {
    c.action = 'review-full';
    c.cost = 'full';
  } else if (own) {
    c.action = 'review-diff';
    c.cost = 'diff';
  } else {
    c.action = 'interface-check';
    c.cost = 'small';
  }
  const openNow = c.findings.filter((f) => f.eff === 'open');
  c.replay = (c.action === 'review-full' ? openNow : openNow.filter((f) => touches(c.changed, f))).map((f) => f.id);
  return c;
}

// ------------------------------------------------------------------ scope and plan

export function parseScope(tokens) {
  const list = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean).flatMap((t) => String(t).split(',')).map((t) => t.trim()).filter(Boolean);
  if (!list.length) return [{ kind: 'full' }];
  return list.map((t) => {
    if (t === 'full' || t === 'normal' || t === 'ai') return { kind: t };
    const m = /^module:([^:]+)(?::(.+))?$/.exec(t);
    if (m) return { kind: 'module', name: m[1], layers: m[2] ? m[2].split('+') : null };
    throw new LedgerError(`Unknown scope "${t}". Use full, normal, ai, or module:<name>[:layer+layer]`);
  });
}

function inScope(cell, scope) {
  return scope.some((s) => {
    if (s.kind === 'full') return true;
    if (s.kind === 'normal') return cell.layer !== 'ai';
    if (s.kind === 'ai') return cell.layer === 'ai';
    return cell.module === s.name && (!s.layers || s.layers.includes(cell.layer));
  });
}

export function reasonText(r) {
  switch (r.type) {
    case 'never': return 'never reviewed';
    case 'incomplete': return 'previous review was incomplete';
    case 'own-files': return `own files changed (+${r.added.length} ~${r.modified.length} -${r.removed.length}): ${[...r.modified, ...r.added, ...r.removed].slice(0, 3).join(', ')}${r.added.length + r.modified.length + r.removed.length > 3 ? ', ...' : ''}`;
    case 'manifests': return `manifests or lockfiles changed: ${[...r.modified, ...r.added, ...r.removed].slice(0, 3).join(', ')}`;
    case 'upstream': return r.newDependency ? `new dependency on ${r.module}` : `upstream module ${r.module} changed`;
    case 'ttl': return `dependency audit is ${r.days} days old`;
    case 'rerun': return 're-run everything requested';
    default: return r.type;
  }
}

export function buildPlan(ctx, ev, opts = {}) {
  const scope = parseScope(opts.scope);
  const rerun = !!opts.rerunAll;
  const work = [];
  const skipped = [];
  const deferred = [];
  const outOfScope = [];
  for (const c of ev.cells) {
    const inS = inScope(c, scope) || (c.layer === 'deps' && scope.some((s) => s.kind === 'full' || s.kind === 'normal'));
    const forced = rerun && inS;
    if (c.state === 'never' || c.state === 'stale' || forced) {
      if (!inS) {
        outOfScope.push({ id: c.id, state: c.state });
        continue;
      }
      const reasons = forced && c.state !== 'never' && c.state !== 'stale' ? [{ type: 'rerun' }] : c.reasons;
      const action = forced && c.state !== 'never' && c.state !== 'stale' ? (c.layer === 'deps' ? 'deps-audit' : 'review-full') : c.action;
      const item = {
        id: c.id, skill: c.skill, action, cost: action === 'review-full' ? 'full' : action === 'deps-audit' ? 'script' : c.cost,
        reasons, changed_files: c.changed ? [...c.changed.added, ...c.changed.modified, ...c.changed.removed] : [],
        replay: c.replay, order: c.order,
        resume: ctx.readPending(c.id)?.started_at ?? null,
      };
      if (opts.noDependents && reasons.length && reasons.every((r) => r.type === 'upstream')) deferred.push(item);
      else work.push(item);
    } else if (inS) {
      skipped.push({ id: c.id, state: c.state, since: c.record.reviewed_at, open: c.findings.filter((f) => f.eff === 'open').length });
    }
  }
  const behind = ev.cells.filter((c) => c.record && c.record.ruleset !== ctx.ruleset).map((c) => c.id);
  return {
    scope: scope.map((s) => (s.kind === 'module' ? `module:${s.name}${s.layers ? ':' + s.layers.join('+') : ''}` : s.kind)),
    rerun_all: rerun,
    ruleset: ctx.ruleset,
    work, skipped, deferred, out_of_scope: outOfScope,
    ruleset_behind: behind,
    orphans: ev.orphans,
    uncovered: uncoveredFiles(ctx, ev),
    ai: getAi(ctx, ev),
  };
}

export function uncoveredFiles(ctx, ev) {
  const covered = new Set();
  for (const c of ev.cells) for (const f of Object.keys(c.files)) covered.add(f);
  const all = ctx.files.filter((f) => !covered.has(f) && !LOCKFILES.has(baseName(f)) && (CODE_EXT.has(baseName(f).split('.').pop()) || CODE_NAMES.test(baseName(f))));
  return { count: all.length, sample: all.slice(0, 15) };
}

// ------------------------------------------------------------------ AI signals
// "Is there model code that no ai cell covers?" answered without a model call. This is what
// turns "a package was installed" or "a new file appeared" into a registry update: an AI SDK
// in a manifest, or an AI import in source, that sits outside every ai layer.
// The lists follow dp-ai-review/references/ai-surface.md (provider SDKs, orchestration,
// local models, vector stores). They are signals to confirm, not a verdict.

const AI_EXACT = new Set([
  'openai', 'anthropic', 'google-generativeai', 'google-genai', 'groq', 'mistralai', 'cohere', 'ollama', 'litellm',
  'langgraph', 'haystack-ai', 'farm-haystack', 'semantic-kernel', 'pyautogen', 'crewai', 'instructor',
  'transformers', 'sentence-transformers', 'vllm', 'llama-cpp-python', 'onnxruntime', 'qdrant-client', 'chromadb',
  'weaviate-client', 'faiss-cpu', 'faiss-gpu', 'torch',
  '@anthropic-ai/sdk', '@google/generative-ai', '@google/genai', 'groq-sdk', '@mistralai/mistralai', 'cohere-ai',
  'llamaindex', '@modelcontextprotocol/sdk', '@xenova/transformers', '@qdrant/js-client-rest', '@pinecone-database/pinecone',
]);
const AI_PREFIX = ['langchain', 'llama-index', 'pydantic-ai', 'dspy', 'pinecone', 'autogen', '@langchain/', '@ai-sdk/', '@huggingface/'];
const isAiPackage = (name, jsDep) => {
  const n = name.toLowerCase().replace(/_/g, '-');
  return (jsDep && n === 'ai') || AI_EXACT.has(n) || AI_PREFIX.some((p) => n.startsWith(p));
};
const AI_PY_IMPORT = /^\s*(?:import|from)\s+(?:openai|anthropic|langchain\w*|langgraph|llama_index|google\.generativeai|google\.genai|groq|mistralai|cohere|ollama|litellm|transformers|sentence_transformers|vllm|llama_cpp|qdrant_client|chromadb|pinecone|weaviate|faiss|haystack|crewai|dspy|instructor|pydantic_ai|autogen|semantic_kernel|onnxruntime)\b/m;
const AI_JS_IMPORT = /(?:from\s+|require\(\s*|import\(\s*)['"](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|groq-sdk|@mistralai\/mistralai|cohere-ai|ollama|ai|@ai-sdk\/[\w.-]+|langchain|@langchain\/[\w.-]+|llamaindex|@modelcontextprotocol\/sdk|@xenova\/transformers|@huggingface\/[\w.-]+|@qdrant\/js-client-rest|chromadb|@pinecone-database\/pinecone|weaviate-client)['"/]/;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+$|_test\.[a-z0-9]+$/;

function manifestPackages(abs, file) {
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return [];
  }
  if (baseName(file) === 'package.json') {
    try {
      const j = JSON.parse(text);
      return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(j[k] ?? {})).filter((n) => isAiPackage(n, true));
    } catch {
      return [];
    }
  }
  if (LOCKFILES.has(baseName(file)) || !/\.(txt|toml|cfg|py)$|^Pipfile$/.test(baseName(file))) return [];
  return [...new Set(text.match(/[A-Za-z0-9_.@/-]+/g) ?? [])].filter((n) => isAiPackage(n, false));
}

export function aiSignals(ctx, ev, { sample = 15 } = {}) {
  const inAiCell = new Set();
  for (const c of ev.cells) if (c.layer === 'ai') for (const f of Object.keys(c.files)) inAiCell.add(f);
  const hasAiCell = ev.cells.some((c) => c.layer === 'ai');
  const isManifest = matcher(ctx.manifests);
  const sdk = [];
  const aiFiles = [];
  for (const f of ctx.files) {
    const abs = path.join(ctx.root, f);
    if (isManifest(f) && !LOCKFILES.has(baseName(f))) {
      for (const p of manifestPackages(abs, f)) sdk.push({ file: f, package: p });
    }
    if (TEST_PATH.test(f)) continue;
    if (f.split('/').includes('prompts') || /\.prompt$/.test(f)) {
      aiFiles.push(f);
      continue;
    }
    const ext = baseName(f).split('.').pop();
    const py = ext === 'py';
    if (!py && !['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) continue;
    try {
      if (fs.statSync(abs).size > 1024 * 1024) continue;
      if ((py ? AI_PY_IMPORT : AI_JS_IMPORT).test(fs.readFileSync(abs, 'utf8'))) aiFiles.push(f);
    } catch { /* unreadable or deleted: no signal */ }
  }
  const outside = aiFiles.filter((f) => !inAiCell.has(f));
  return {
    sdk_in_manifests: sdk,
    ai_files: aiFiles.length,
    outside_ai_cells: { count: outside.length, sample: outside.slice(0, sample) },
    no_ai_layer: (sdk.length > 0 || aiFiles.length > 0) && !hasAiCell,
  };
}

const getAi = (ctx, ev) => (ev.ai ??= aiSignals(ctx, ev));

// The first read of a project, before any registry exists: where the manifests are, how the
// top level is laid out, and whether any model code is present. Deterministic, no model call.
export function scanProject(rootArg, ignore = []) {
  const root = path.resolve(rootArg);
  const files = listFiles(root, ignore);
  const isManifest = matcher(MANIFEST_GLOBS);
  const top = new Map();
  for (const f of files) {
    const key = f.includes('/') ? f.split('/')[0] + '/' : '(files at the root)';
    top.set(key, (top.get(key) ?? 0) + 1);
  }
  let git = false;
  try {
    git = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true';
  } catch { /* no git, or not a repo */ }
  return {
    root,
    git,
    file_count: files.length,
    manifests: files.filter((f) => isManifest(f) && !LOCKFILES.has(baseName(f))),
    top_level: [...top].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name, count]) => ({ name, files: count })),
    ai: aiSignals({ root, files, manifests: MANIFEST_GLOBS }, { cells: [] }, { sample: 60 }),
  };
}

// ------------------------------------------------------------------ status

export function buildStatus(ctx, ev, opts = {}) {
  const counts = { never: 0, stale: 0, open: 0, accepted: 0, clean: 0 };
  const open = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const cells = ev.cells.map((c) => {
    counts[c.state]++;
    const sev = countBySeverity(c.findings);
    for (const k of SEVERITIES) open[k] += sev[k];
    return { id: c.id, state: c.state, verdict: c.verdict, open: sev, reviewed_at: c.record?.reviewed_at ?? null, ruleset: c.record?.ruleset ?? null, reasons: c.reasons.map(reasonText), block_rule: c.record?.block_rule ?? null };
  });
  const notCurrent = cells.filter((c) => c.state === 'never' || c.state === 'stale');
  let rollup = 'SHIP';
  if (cells.some((c) => c.verdict === 'BLOCK')) rollup = 'BLOCK';
  else if (notCurrent.length) rollup = 'INCOMPLETE';
  else if (cells.some((c) => c.verdict === 'SHIP WITH FIXES')) rollup = 'SHIP WITH FIXES';

  const failOn = SEVERITIES.indexOf(opts.failOn ?? 'High');
  const problems = [];
  for (const c of cells) {
    for (const k of SEVERITIES.slice(0, failOn + 1)) if (c.open[k]) problems.push(`${c.id}: ${plural(c.open[k], k + ' finding')} open`);
    if (c.block_rule) problems.push(`${c.id}: BLOCK rule "${c.block_rule}"`);
    if (!opts.allowStale && (c.state === 'never' || c.state === 'stale')) problems.push(`${c.id}: ${c.state} (${c.reasons.join('; ')})`);
  }
  const ai = getAi(ctx, ev);
  const uncovered = uncoveredFiles(ctx, ev);
  // Coverage gaps are registry-quality problems. They only fail a check when asked (--strict).
  if (opts.strict) {
    if (uncovered.count) problems.push(`${plural(uncovered.count, 'code or config file')} in no cell, e.g. ${uncovered.sample.slice(0, 3).join(', ')}`);
    if (ai.no_ai_layer) problems.push('AI signals found but the registry has no ai layer');
    else if (ai.outside_ai_cells.count) problems.push(`${plural(ai.outside_ai_cells.count, 'AI file')} outside every ai layer, e.g. ${ai.outside_ai_cells.sample.slice(0, 3).join(', ')}`);
  }
  return {
    rollup, counts, open, cells,
    not_current: notCurrent.map((c) => c.id),
    ruleset: ctx.ruleset,
    ruleset_behind: ev.cells.filter((c) => c.record && c.record.ruleset !== ctx.ruleset).map((c) => c.id),
    uncovered,
    ai,
    orphans: ev.orphans,
    check: { ok: problems.length === 0, problems },
  };
}

// ------------------------------------------------------------------ begin / record / accept

function gitHead(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

function requireDef(ctx, id) {
  const d = cellDefs(ctx).find((x) => x.id === id);
  if (!d) throw new LedgerError(`Unknown cell "${id}". Cells: ${cellDefs(ctx).map((x) => x.id).join(', ')}`);
  return d;
}

// Snapshot the cell BEFORE the review starts. `record` uses this snapshot, so a file edited
// while the review ran is seen as changed next time instead of being silently blessed.
export function beginCell(ctx, id, ev = evaluate(ctx)) {
  const def = requireDef(ctx, id);
  const cell = ev.cells.find((c) => c.id === id);
  const snap = { fingerprint: cell.fingerprint, files: cell.files, upstream: cell.upstreamNow, started_at: new Date().toISOString(), module: def.module };
  ctx.writePending(id, snap);
  return snap;
}

const SEV_ALIASES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const ID_RE = /^[A-Za-z0-9._-]+$/;

function cleanPath(p, what) {
  if (typeof p !== 'string' || !p) throw new LedgerError(`${what}: file is required`);
  const q = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (q.startsWith('/') || /^[A-Za-z]:/.test(q) || q.split('/').includes('..')) throw new LedgerError(`${what}: file must be relative to the project root`);
  return q;
}

export function validateFindingsInput(inp, opts = {}) {
  const errors = [];
  const out = { findings: [], resolved: [] };
  const ids = new Set();
  inp = inp ?? {};
  for (const [i, f] of (inp.findings ?? []).entries()) {
    const at = `findings[${i}]${f?.id ? ` (${f.id})` : ''}`;
    try {
      if (!f || typeof f.id !== 'string' || !ID_RE.test(f.id)) throw new LedgerError(`${at}: id must match ${ID_RE}`);
      if (ids.has(f.id)) throw new LedgerError(`${at}: duplicate id`);
      ids.add(f.id);
      const sev = SEV_ALIASES[String(f.severity).toLowerCase()];
      if (!sev) throw new LedgerError(`${at}: severity must be one of ${SEVERITIES.join(', ')}`);
      if (typeof f.title !== 'string' || !f.title.trim()) throw new LedgerError(`${at}: title is required`);
      if (typeof f.scenario !== 'string' || !f.scenario.trim()) throw new LedgerError(`${at}: scenario is required (it is what a later run replays)`);
      if (f.line != null && !(Number.isInteger(f.line) && f.line > 0)) throw new LedgerError(`${at}: line must be a positive integer`);
      if (f.check !== undefined) {
        if (typeof f.check?.regex !== 'string') throw new LedgerError(`${at}: check.regex must be a string`);
        try { new RegExp(f.check.regex); } catch { throw new LedgerError(`${at}: check.regex is not a valid regular expression`); }
      }
      if (f.also !== undefined && !Array.isArray(f.also)) throw new LedgerError(`${at}: also must be an array of files`);
      out.findings.push({
        id: f.id, severity: sev, title: f.title.trim(),
        // Only an import may carry a finding with no file (an evidence gap has no code to point at).
        file: f.file == null && opts.allowNoLocation ? null : cleanPath(f.file, at),
        also: (f.also ?? []).map((p) => cleanPath(p, at)),
        line: f.line ?? null,
        scenario: f.scenario.trim(), fix: f.fix ?? null, check: f.check ?? null, baseline: f.baseline === true,
        status: typeof f.status === 'string' ? f.status.slice(0, 80) : null,
        maps_to: typeof f.maps_to === 'string' ? f.maps_to.slice(0, 80) : null,
        note: typeof f.note === 'string' ? f.note.slice(0, 500) : null,
      });
    } catch (e) {
      errors.push(e.message);
    }
  }
  for (const [i, r] of (inp.resolved ?? []).entries()) {
    if (!r || typeof r.id !== 'string' || typeof r.evidence !== 'string' || !r.evidence.trim()) errors.push(`resolved[${i}]: id and evidence are required`);
    else if (ids.has(r.id)) errors.push(`resolved[${i}]: ${r.id} is listed both as open and as resolved`);
    else out.resolved.push({ id: r.id, evidence: r.evidence.trim() });
  }
  if (errors.length) throw new LedgerError('Invalid findings input:\n  ' + errors.join('\n  '));
  return out;
}

function mergeFindings({ prior, input, kind, changed, hashOf, today, snapFiles }) {
  const priorEff = prior ? effectiveFindings(prior.findings, hashOf, today) : [];
  const byIdPrior = new Map(priorEff.map((f) => [f.id, f]));
  const resolvedMap = new Map(input.resolved.map((r) => [r.id, r]));
  const newIds = new Set(input.findings.map((f) => f.id));
  const unknown = [...resolvedMap.keys()].filter((id) => !byIdPrior.has(id));
  if (unknown.length) throw new LedgerError(`resolved ids not found in the previous review: ${unknown.join(', ')}`);

  const next = {};
  const resolvedNow = [];
  const unaccounted = [];
  const strip = ({ eff, lapse, ...rest }) => rest; // eslint-disable-line no-unused-vars
  for (const f of priorEff) {
    if (newIds.has(f.id)) continue;
    if (resolvedMap.has(f.id)) {
      resolvedNow.push({ id: f.id, severity: f.severity, title: f.title, file: f.file, resolved_at: today, evidence: resolvedMap.get(f.id).evidence });
      continue;
    }
    const mustAccount = f.eff === 'open' && (kind === 'full' || kind === 'deps' || (kind === 'diff' && touches(changed, f)));
    if (mustAccount) unaccounted.push(f.id);
    else next[f.id] = strip(f);
  }
  if (unaccounted.length) {
    throw new LedgerError(
      `Earlier open findings not accounted for: ${unaccounted.join(', ')}.\n` +
        '  List each under "findings" if it still reproduces, or under "resolved" with the evidence it no longer does.\n' +
        '  A finding cannot disappear because a review did not mention it.',
    );
  }
  for (const nf of input.findings) {
    const prev = byIdPrior.get(nf.id);
    const keep = { id: nf.id, severity: nf.severity, title: nf.title, file: nf.file, also: nf.also, line: nf.line, scenario: nf.scenario, fix: nf.fix, check: nf.check, status: nf.status, maps_to: nf.maps_to, note: nf.note };
    const fileHash = locHash(hashOf, nf);
    if (prev && prev.state === 'accepted' && !prev.lapse) next[nf.id] = { ...strip(prev), ...keep };
    else if (nf.baseline) next[nf.id] = { ...keep, state: 'accepted', first_seen: prev?.first_seen ?? today, accepted: { by: 'baseline', reason: 'listed in the skill baseline file', at: today, expires: null, file_hash: fileHash } };
    else next[nf.id] = { ...keep, state: 'open', first_seen: prev?.first_seen ?? today };
  }
  return { findings: next, resolved: resolvedNow };
}

export function recordCell(ctx, id, inputRaw, o = {}) {
  const def = requireDef(ctx, id);
  const isDeps = id === DEPS_ID;
  const kind = o.kind ?? (isDeps ? 'deps' : 'full');
  if (!KINDS.includes(kind)) throw new LedgerError(`--kind must be one of ${KINDS.join(', ')}`);
  if (isDeps !== (kind === 'deps')) throw new LedgerError(isDeps ? `${id} is recorded with --kind deps` : '--kind deps is only for project/deps');
  const prior = ctx.readCell(id);
  if ((kind === 'diff' || kind === 'interface') && !prior) throw new LedgerError(`${id} has no earlier review, so --kind ${kind} is not possible. Record with --kind full.`);

  const input = validateFindingsInput(inputRaw, { allowNoLocation: !!o.allowNoLocation });
  let reviewedAt = ctx.today;
  if (o.reviewedAt) {
    if (!validDate(o.reviewedAt) || o.reviewedAt > ctx.today) throw new LedgerError('The review date must be YYYY-MM-DD and not in the future');
    reviewedAt = o.reviewedAt;
  }
  const ev = evaluate(ctx);
  const live = ev.cells.find((c) => c.id === id);
  const pending = ctx.readPending(id);
  const snap = pending ?? { fingerprint: live.fingerprint, files: live.files, upstream: live.upstreamNow };
  const warnings = [];
  if (!pending && !o.importedFrom) warnings.push('no `begin` snapshot: fingerprint taken now. Files edited during the review would be treated as reviewed.');
  const hashOf = (f) => snap.files[f] ?? ctx.hashOf(f);
  const changed = prior?.files ? diffFiles(prior.files, snap.files) : null;
  const merged = mergeFindings({ prior, input, kind, changed, hashOf, today: ctx.today, snapFiles: snap.files });

  const partial = kind === 'interface';
  const rec = {
    schema: SCHEMA, id, module: def.module, layer: def.layer, skill: def.skill,
    fingerprint: partial ? prior.fingerprint : snap.fingerprint,
    files: partial ? prior.files : snap.files,
    upstream: snap.upstream ?? {},
    complete: partial ? prior.complete : !o.incomplete,
    block_rule: partial ? (o.blockRule ?? prior.block_rule ?? null) : (o.blockRule ?? null),
    reported_verdict: o.verdict ?? null,
    depth: o.depth ?? prior?.depth ?? null,
    reviewed_at: partial ? prior.reviewed_at : reviewedAt,
    reviewed_commit: partial ? prior.reviewed_commit : (o.commit ?? gitHead(ctx.root)),
    ruleset: partial ? prior.ruleset : (o.ruleset ?? ctx.ruleset),
    imported_from: partial ? prior.imported_from : o.importedFrom,
    report: o.report ?? prior?.report ?? null,
    findings: merged.findings,
    resolved: [...(prior?.resolved ?? []), ...merged.resolved].slice(-200),
  };
  const eff = effectiveFindings(rec.findings, hashOf, ctx.today);
  const verdict = cellVerdict(rec, eff);
  if (o.verdict && rank(o.verdict) > rank(verdict) && !rec.block_rule) {
    warnings.push(`reported verdict ${o.verdict} is stricter than the findings imply (${verdict}). If BLOCK is for a reason that is not a finding (failing build, say), pass --block-rule "<reason>".`);
  }
  rec.history = [...(prior?.history ?? []), { at: partial ? ctx.today : reviewedAt, kind, verdict, open: eff.filter((f) => f.eff === 'open').length }].slice(-10);
  if (o.report && !fs.existsSync(path.resolve(ctx.root, o.report))) warnings.push(`report file not found: ${o.report}`);
  ctx.writeCell(rec);
  ctx.clearPending(id);
  return { record: rec, verdict, open: countBySeverity(eff), resolved: merged.resolved.length, warnings };
}

export function acceptFinding(ctx, id, fid, o = {}) {
  const rec = ctx.readCell(id);
  if (!rec) throw new LedgerError(`${id} has no recorded review`);
  const f = rec.findings[fid];
  if (!f) throw new LedgerError(`${id} has no finding "${fid}". Findings: ${Object.keys(rec.findings).join(', ') || '(none)'}`);
  if (f.severity === 'Critical') throw new LedgerError('A Critical finding cannot be accepted: it blocks by rule. Fix it, or re-review and downgrade it with evidence.');
  if (!o.reason || o.reason.trim().length < 8) throw new LedgerError('--reason is required (at least 8 characters): say why this risk is acceptable');
  const expires = o.expires ?? addDays(ctx.today, o.days ?? DEFAULT_ACCEPT_DAYS);
  if (!validDate(expires)) throw new LedgerError('--expires must be YYYY-MM-DD');
  if (expires <= ctx.today) throw new LedgerError('--expires must be in the future');
  f.state = 'accepted';
  f.accepted = { reason: o.reason.trim(), at: ctx.today, expires, by: o.by ?? null, file_hash: locHash(ctx.hashOf, f) };
  ctx.writeCell(rec);
  return f;
}

export function reopenFinding(ctx, id, fid) {
  const rec = ctx.readCell(id);
  const f = rec?.findings?.[fid];
  if (!f) throw new LedgerError(`${id} has no finding "${fid}"`);
  f.state = 'open';
  delete f.accepted;
  ctx.writeCell(rec);
  return f;
}

// Hints only. A pattern that no longer matches is evidence a finding may be fixed, not proof:
// the code could have moved. The replaying review still decides.
export function recheck(ctx, id) {
  const rec = ctx.readCell(id);
  if (!rec) throw new LedgerError(`${id} has no recorded review`);
  return effectiveFindings(rec.findings, ctx.hashOf, ctx.today).filter((f) => f.eff === 'open').map((f) => {
    const file = f.check?.file ?? f.file;
    let hint = 'no-check';
    if (f.check?.regex) {
      let text = null;
      if (file) {
        try { text = fs.readFileSync(path.join(ctx.root, file), 'utf8'); } catch { /* missing */ }
      }
      hint = text === null ? 'file-missing' : new RegExp(f.check.regex, 'm').test(text) ? 'still-present' : 'pattern-gone';
    }
    return { id: f.id, file, hint };
  });
}

// ------------------------------------------------------------------ importing an earlier review
// A review that ran before the ledger existed should not be paid for twice. `import` reads its
// sidecar, proves the code has not changed since, and records it as a cell. It understands the
// sidecar dp-ai-review actually wrote (`sev`, `where`), and the standard one (orchestrated-mode.md).

export function isLegacySidecar(sc) {
  return !!sc && typeof sc === 'object' && Array.isArray(sc.findings) && sc.findings.length > 0 && sc.findings.every((f) => f && ('sev' in f || 'where' in f));
}

// `where` entries look like "providers/llm.py:698-717" and are relative to the component, so a
// path is matched against the real file list by its ending. A path that matches no file, or
// more than one even after preferring the component folder, is kept as a note, never guessed.
export function normalizeLegacySidecar(sc, { files, base = '' }) {
  const byName = new Map();
  for (const f of files) {
    const k = baseName(f);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f);
  }
  const prefix = base ? base.replace(/\\/g, '/').replace(/\/+$/, '') + '/' : '';
  const resolve = (p) => {
    const cands = (byName.get(baseName(p)) ?? []).filter((f) => f === p || f.endsWith('/' + p));
    if (cands.length === 1) return cands[0];
    const near = prefix ? cands.filter((f) => f.startsWith(prefix)) : [];
    return near.length === 1 ? near[0] : null;
  };
  const findings = [];
  const skipped = [];
  let noLocation = 0;
  for (const f of sc.findings) {
    const severity = SEV_ALIASES[String(f.sev ?? f.severity).toLowerCase()];
    if (!severity || typeof f.id !== 'string' || typeof f.title !== 'string') {
      skipped.push(String(f?.id ?? '(no id)'));
      continue;
    }
    const hits = [];
    const lost = [];
    for (const w of Array.isArray(f.where) ? f.where : f.where ? [f.where] : []) {
      const m = /^(.+?)(?::(\d+)[\d,\s-]*)?$/.exec(String(w).trim());
      const hit = m ? resolve(m[1].replace(/\\/g, '/').replace(/^\.\//, '')) : null;
      if (hit) hits.push({ file: hit, line: m[2] ? Number(m[2]) : null });
      else lost.push(String(w));
    }
    const primary = hits[0] ?? null;
    if (!primary) noLocation++;
    findings.push({
      id: f.id, severity, title: f.title,
      file: primary?.file ?? null,
      line: primary?.line ?? null,
      also: [...new Set(hits.slice(1).map((h) => h.file))].filter((x) => x !== primary?.file),
      // The sidecar carries no scenario; the full one is in the report. A later run replays the title.
      scenario: `${f.title} [imported: the full failure scenario is in the report, not the sidecar]`,
      status: f.status,
      maps_to: f.maps_to,
      note: lost.length ? `locations not matched to a file: ${lost.join('; ')}` : undefined,
    });
  }
  return { findings, resolved: [], skipped, no_location: noLocation };
}

// Files that differ from `commit`: tracked changes (staged or not), deletions, and untracked files.
// Null when git or the commit is unavailable, so the caller can refuse instead of assuming.
function changedSince(root, commit) {
  const git = (args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
    return new Set([...git(['diff', '-z', '--name-only', '--no-renames', '--relative', commit, '--']), ...git(['ls-files', '-z', '--others', '--exclude-standard'])]);
  } catch {
    return null;
  }
}

export function importCell(ctx, id, sidecarPath, o = {}) {
  requireDef(ctx, id);
  if (ctx.readCell(id)) throw new LedgerError(`${id} already has a recorded review. Import is for a cell that was never recorded; use record for a new review.`);
  const abs = path.resolve(sidecarPath);
  const raw = readJson(abs);
  if (!raw) throw new LedgerError(`Sidecar not found: ${sidecarPath}`);
  const cell = evaluate(ctx).cells.find((c) => c.id === id);
  const date = o.reviewedAt ?? (validDate(raw.date) ? raw.date : null);
  if (!date) throw new LedgerError('The sidecar has no valid "date" (YYYY-MM-DD). Pass --reviewed-at.');
  const commit = typeof raw.base_commit === 'string' ? raw.base_commit : null;

  // Recording a review stamps the CURRENT files as reviewed. That is only true if nothing in the
  // cell has changed since the review ran, so prove it, or refuse.
  if (!o.assumeUnchanged) {
    if (!commit) throw new LedgerError('The sidecar has no base_commit, so the code cannot be checked against the review. Pass --assume-unchanged only if you know it has not changed since ' + date + '.');
    const changed = changedSince(ctx.root, commit);
    if (!changed) throw new LedgerError(`Cannot compare with commit ${commit} (no git, or the commit is unknown here). Pass --assume-unchanged only if you know the code has not changed since ${date}.`);
    const moved = Object.keys(cell.files).filter((f) => changed.has(f)).sort();
    if (moved.length) {
      throw new LedgerError(`${plural(moved.length, 'file')} in ${id} changed since the review's base commit ${commit}, e.g. ${moved.slice(0, 5).join(', ')}.\n  Importing would record the changed code as reviewed. Review ${id} instead.`);
    }
  }

  const legacy = isLegacySidecar(raw);
  const norm = legacy ? normalizeLegacySidecar(raw, { files: ctx.files, base: o.base ?? raw.component ?? '' }) : { findings: raw.findings ?? [], resolved: [], skipped: [], no_location: 0 };
  const rel = posix(path.relative(ctx.root, abs));
  let report = o.report ?? null;
  if (!report) {
    const guess = abs.replace(/\.json$/i, '.md');
    if (guess !== abs && fs.existsSync(guess)) report = posix(path.relative(ctx.root, guess));
  }
  const result = recordCell(ctx, id, norm, {
    kind: 'full', verdict: raw.verdict, depth: ['quick', 'deep'].includes(raw.depth) ? raw.depth : null, report,
    commit, reviewedAt: date, ruleset: o.reviewedRuleset ?? raw.ruleset ?? 'unknown', importedFrom: rel, allowNoLocation: true,
  });
  return { ...result, imported: { legacy, findings: norm.findings.length, no_location: norm.no_location, skipped: norm.skipped, date, commit, report } };
}

// The work order handed to a review skill for one cell. Everything a reviewer must not have to
// guess lives here: which files, which earlier findings to replay, what is already accepted,
// which sibling cells cover the rest of the module, and the next free finding id.
const BRIEF_FILE_CAP = 400;
export function buildBrief(ctx, ev, id, opts = {}) {
  const cell = ev.cells.find((c) => c.id === id);
  if (!cell) throw new LedgerError(`Unknown cell "${id}". Cells: ${ev.cells.map((c) => c.id).join(', ')}`);
  const rec = cell.record;
  const stale = cell.state === 'never' || cell.state === 'stale';
  if (!stale && !opts.rerunAll) throw new LedgerError(`${id} is current (${cell.state}, unchanged since ${rec.reviewed_at}); there is nothing to review. Use --rerun-all to force it.`);
  const action = stale ? cell.action : cell.layer === 'deps' ? 'deps-audit' : 'review-full';
  const kind = { 'review-full': 'full', 'review-diff': 'diff', 'interface-check': 'interface', 'deps-audit': 'deps' }[action];
  const changed = cell.changed ? [...cell.changed.added, ...cell.changed.modified, ...cell.changed.removed] : [];
  const open = cell.findings.filter((f) => f.eff === 'open');
  const replayIds = new Set(kind === 'full' || kind === 'deps' ? open.map((f) => f.id) : cell.replay);
  const slug = id.replace('/', '-');
  const used = [...Object.keys(rec?.findings ?? {}), ...(rec?.resolved ?? []).map((r) => r.id)]
    .map((x) => new RegExp(`^${slug}-(\\d+)$`).exec(x)?.[1])
    .filter(Boolean)
    .map(Number);
  const upstream = cell.reasons.filter((r) => r.type === 'upstream').map((r) => ({
    module: r.module,
    changed_files: ev.cells.filter((c) => c.module === r.module && c.changed).flatMap((c) => [...c.changed.added, ...c.changed.modified, ...c.changed.removed]).sort(),
  }));
  const files = Object.keys(cell.files).sort();
  const slim = (f) => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, also: f.also ?? [], line: f.line, scenario: f.scenario, fix: f.fix, check: f.check, status: f.status ?? null, first_seen: f.first_seen });
  return {
    cell: id, module: cell.module, layer: cell.layer, skill: cell.skill, kind,
    reasons: stale ? cell.reasons.map(reasonText) : ['re-run everything requested'],
    depth: opts.depth ?? rec?.depth ?? null,
    file_count: files.length, files: files.slice(0, BRIEF_FILE_CAP), files_truncated: files.length > BRIEF_FILE_CAP,
    changed_files: changed,
    upstream_changed: upstream,
    replay: open.filter((f) => replayIds.has(f.id)).map(slim),
    carry_forward: open.filter((f) => !replayIds.has(f.id)).map((f) => f.id),
    already_accepted: cell.findings.filter((f) => f.eff === 'accepted').map((f) => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, reason: f.accepted?.reason ?? null })),
    next_id: `${slug}-${String(Math.max(0, ...used) + 1).padStart(3, '0')}`,
    siblings: ev.cells.filter((c) => c.module === cell.module && c.id !== id).map((c) => ({ id: c.id, layer: c.layer, state: c.state, verdict: c.verdict })),
    prior: rec ? { reviewed_at: rec.reviewed_at, verdict: cell.verdict, ruleset: rec.ruleset, report: rec.report } : null,
    ruleset: ctx.ruleset,
  };
}

export function pruneOrphans(ctx, ev) {
  for (const id of ev.orphans) fs.rmSync(path.join(ctx.dir, 'cells', cellFile(id)), { force: true });
  return ev.orphans;
}

// ------------------------------------------------------------------ rendering

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderProgress(ctx, ev, plan, status) {
  const L = [];
  const mods = Object.keys(ctx.registry.modules).length;
  L.push('# Security review progress', '');
  L.push('> Generated by `ledger.mjs render` from `reviews/.ledger/`. Do not edit by hand: use `accept` / `reopen`, or run a review.');
  L.push('> **Clean means no findings under that ruleset on that date. It does not mean secure.**', '');
  const open = status.open;
  L.push(`**Overall: ${status.rollup}** - open findings: ${open.Critical} Critical, ${open.High} High, ${open.Medium} Medium, ${open.Low} Low${status.not_current.length ? ` - ${plural(status.not_current.length, 'cell')} not current` : ''}`, '');
  L.push(`Ruleset now: ${ctx.ruleset} - ${plural(mods, 'module')}, ${plural(ev.cells.length, 'cell')}`, '');
  L.push('| Module | Layer | State | Verdict | Open C/H/M/L | Last reviewed | Ruleset | Why not current |', '|---|---|---|---|---|---|---|---|');
  for (const c of ev.cells) {
    const s = status.cells.find((x) => x.id === c.id);
    L.push(`| ${c.module} | ${c.layer} | ${c.state} | ${c.verdict ?? '-'} | ${SEVERITIES.map((k) => s.open[k]).join('/')} | ${c.record?.reviewed_at ?? '-'} | ${c.record?.ruleset ?? '-'} | ${esc(c.reasons.map(reasonText).join('; ') || '-')} |`);
  }
  L.push('', '## Next run', '');
  L.push(`Needs work: ${plural(plan.work.length, 'cell')} - skipped unchanged: ${plan.skipped.length}`, '');
  for (const w of plan.work) L.push(`- \`${w.id}\` - ${w.action} (${w.cost}): ${esc(w.reasons.map(reasonText).join('; '))}`);
  if (!plan.work.length) L.push('- Nothing. Every cell is current.');
  const openF = ev.cells.flatMap((c) => c.findings.filter((f) => f.eff === 'open').map((f) => ({ ...f, cell: c.id })));
  L.push('', '## Open findings', '');
  if (!openF.length) L.push('None.');
  else {
    L.push('| Id | Cell | Severity | Where | Title |', '|---|---|---|---|---|');
    for (const f of openF.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id))) {
      L.push(`| ${f.id} | ${f.cell} | ${f.severity} | ${esc(f.file ?? '-')}${f.line ? ':' + f.line : ''}${f.also?.length ? ` (+${f.also.length} more)` : ''} | ${esc(f.title)}${f.lapse ? ` (acceptance lapsed: ${f.lapse})` : ''} |`);
    }
  }
  if (status.ruleset_behind.length) L.push('', `Reviewed under an older ruleset: ${status.ruleset_behind.join(', ')}. Nothing is forced; re-run them to apply the newer checklists.`);
  if (status.uncovered.count) L.push('', `## Not covered by any cell`, '', `${plural(status.uncovered.count, 'code or config file')} belong to no module layer, so no review reads them: ${status.uncovered.sample.map((f) => '`' + f + '`').join(', ')}${status.uncovered.count > status.uncovered.sample.length ? ', ...' : ''}. Add them to a layer (an \`infra\` layer fits CI and Docker files) or to \`ignore\`.`);
  const ai = status.ai;
  if (ai.no_ai_layer || ai.outside_ai_cells.count) {
    L.push('', '## AI code outside any ai layer', '');
    if (ai.no_ai_layer) L.push(`AI signals were found (${ai.sdk_in_manifests.length ? ai.sdk_in_manifests.slice(0, 4).map((s) => '`' + s.package + '`').join(', ') + ' in manifests' : plural(ai.ai_files, 'file') + ' importing a model SDK'}) but the registry has no \`ai\` layer, so \`dp-ai-review\` has never read this code. Add one.`);
    else L.push(`${plural(ai.outside_ai_cells.count, 'file')} import a model SDK or hold prompts but sit in no \`ai\` layer: ${ai.outside_ai_cells.sample.map((f) => '`' + f + '`').join(', ')}${ai.outside_ai_cells.count > ai.outside_ai_cells.sample.length ? ', ...' : ''}.`);
  }
  if (ev.orphans.length) L.push('', `Cell records with no module in the registry: ${ev.orphans.join(', ')}. Run \`ledger.mjs prune\` to remove them.`);
  return L.join('\n') + '\n';
}

// Not `progress.md`: people keep their own PROGRESS.md in reviews/, and on Windows and macOS
// the two names are the same file. The generated view gets a name nobody else would pick,
// and the tool refuses to overwrite a file it did not write.
export const PROGRESS_FILE = 'security-progress.md';
const PROGRESS_HEADER = '# Security review progress';

export function writeProgress(ctx, ev = evaluate(ctx)) {
  const plan = buildPlan(ctx, ev, {});
  const status = buildStatus(ctx, ev, {});
  const file = path.join(ctx.root, 'reviews', PROGRESS_FILE);
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').startsWith(PROGRESS_HEADER)) {
    throw new LedgerError(`reviews/${PROGRESS_FILE} exists but was not written by ledger.mjs, so it was left alone. Move or rename it, then run: ledger.mjs render`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderProgress(ctx, ev, plan, status));
  return file;
}

// ------------------------------------------------------------------ CLI

const BOOL_FLAGS = new Set(['json', 'check', 'rerun-all', 'no-dependents', 'incomplete', 'help', 'allow-stale', 'strict', 'assume-unchanged']);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-' || !a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
    let v = eq === -1 ? undefined : a.slice(eq + 1);
    if (v === undefined) {
      if (BOOL_FLAGS.has(k)) v = true;
      else {
        v = argv[++i];
        if (v === undefined) throw new LedgerError(`--${k} needs a value`);
      }
    }
    flags[k] = k in flags ? [].concat(flags[k], v) : v;
  }
  return { pos, flags };
}

function findRoot(flags) {
  if (flags.root) return path.resolve(flags.root);
  let cur = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(cur, 'reviews', '.ledger', 'registry.json'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return process.cwd();
    cur = up;
  }
}

const readInput = (p) => (p === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(p, 'utf8'));
function parseJsonInput(p, what) {
  try {
    return JSON.parse(readInput(p));
  } catch (e) {
    throw new LedgerError(`${what}: ${e.message}`);
  }
}

function formatPlan(plan) {
  const L = [];
  L.push(`Scope: ${plan.scope.join(', ')}${plan.rerun_all ? ' (re-run everything)' : ''}   Ruleset: ${plan.ruleset}`);
  L.push(`Needs work: ${plan.work.length} - skipped unchanged: ${plan.skipped.length}${plan.deferred.length ? ` - deferred dependents: ${plan.deferred.length}` : ''}${plan.out_of_scope.length ? ` - stale outside scope: ${plan.out_of_scope.length}` : ''}`);
  plan.work.forEach((w, i) => {
    L.push(`  ${i + 1}. ${w.id}  [${w.skill}]  ${w.action} (${w.cost})${w.resume ? '  RESUME (interrupted run)' : ''}`);
    for (const r of w.reasons) L.push(`       - ${reasonText(r)}`);
    if (w.replay.length) L.push(`       - replay first: ${w.replay.join(', ')}`);
  });
  for (const s of plan.skipped) L.push(`  skip ${s.id}  ${s.state}, unchanged since ${s.since}${s.open ? `, ${plural(s.open, 'open finding')}` : ''}`);
  for (const d of plan.deferred) L.push(`  deferred ${d.id}  (${d.reasons.map(reasonText).join('; ')})`);
  for (const o of plan.out_of_scope) L.push(`  outside scope ${o.id}  ${o.state}`);
  if (plan.ruleset_behind.length) L.push(`Reviewed under an older ruleset: ${plan.ruleset_behind.join(', ')} (not forced)`);
  if (plan.uncovered.count) L.push(`Uncovered: ${plural(plan.uncovered.count, 'code or config file')} in no cell, e.g. ${plan.uncovered.sample.slice(0, 4).join(', ')}`);
  if (plan.orphans.length) L.push(`Orphan cell records: ${plan.orphans.join(', ')} (ledger.mjs prune)`);
  L.push(...aiLines(plan.ai));
  return L.join('\n');
}

function aiLines(ai) {
  if (ai.no_ai_layer) return [`AI signals but NO ai layer in the registry (${ai.sdk_in_manifests.slice(0, 3).map((s) => s.package).join(', ') || plural(ai.ai_files, 'file')}): add one so dp-ai-review reads it`];
  if (ai.outside_ai_cells.count) return [`AI code outside any ai layer: ${plural(ai.outside_ai_cells.count, 'file')}, e.g. ${ai.outside_ai_cells.sample.slice(0, 3).join(', ')}`];
  return [];
}

function formatStatus(st) {
  const c = st.counts;
  const L = [`Overall: ${st.rollup}`, `Cells: clean ${c.clean} - accepted ${c.accepted} - open ${c.open} - stale ${c.stale} - never ${c.never}`, `Open findings: Critical ${st.open.Critical} - High ${st.open.High} - Medium ${st.open.Medium} - Low ${st.open.Low}`];
  for (const x of st.cells) L.push(`  ${x.id.padEnd(28)} ${x.state.padEnd(9)} ${(x.verdict ?? '-').padEnd(16)} ${x.reviewed_at ?? '-'}`);
  if (st.uncovered.count) L.push(`Uncovered: ${st.uncovered.count} code or config files in no cell`);
  L.push(...aiLines(st.ai));
  if (st.check.problems.length) L.push('Check problems:', ...st.check.problems.map((p) => '  - ' + p));
  return L.join('\n');
}

const HELP = `ledger.mjs - progress ledger and planner for /dp-security

  scan                      first read, no registry needed: manifests, top-level layout, AI signals
  registry set <file|->     validate and store the module registry
  registry show | check     print it | validate it and report empty cells
  coverage                  per-cell file counts and files no cell reviews
  plan [--scope S] [--rerun-all] [--no-dependents]
                            what needs a review now; S = full | normal | ai | module:<name>[:layer+layer]
  brief <cell> [--rerun-all] [--depth quick|deep]
                            JSON work order for one cell: files, findings to replay, next id
  begin <cell>...           snapshot cells before a review starts
  record <cell> [--kind full|diff|interface|deps] [--findings <file|->] [--verdict V]
         [--depth quick|deep] [--report path] [--block-rule "why"] [--incomplete] [--commit sha]
                            store a finished review; consumes the begin snapshot
  import <cell> <sidecar> [--report path] [--base dir] [--reviewed-at YYYY-MM-DD] [--reviewed-ruleset V]
         [--assume-unchanged]
                            record a review that ran before the ledger existed; refuses unless the
                            code is proven unchanged since the review's base commit
  accept <cell> <id> --reason "..." [--expires YYYY-MM-DD | --days N] [--by name]
  reopen <cell> <id>
  recheck <cell>            hints from machine checks on open findings (not proof)
  status [--check] [--fail-on Critical|High|Medium|Low] [--allow-stale] [--strict]
                            rollup; --check exits 1 on problems (for CI); --strict also fails on
                            files in no cell and on AI code outside every ai layer
  render                    write reviews/security-progress.md
  prune                     delete cell records whose module left the registry

Common: --root <dir>  --json  --now YYYY-MM-DD (tests)   Exit: 0 ok, 1 check failed, 2 error`;

export function main(argv, out = (s) => process.stdout.write(s + '\n')) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0];
  if (!cmd || flags.help || cmd === 'help') {
    out(HELP);
    return 0;
  }
  const root = findRoot(flags);
  const emit = (obj, text) => out(flags.json ? stableStringify(obj).trimEnd() : text);
  const ctxOpts = { now: flags.now, ruleset: flags.ruleset };

  if (cmd === 'registry') {
    const sub = pos[1];
    if (sub === 'set') {
      if (!pos[2]) throw new LedgerError('registry set needs a file path or -');
      const reg = parseJsonInput(pos[2], 'registry');
      const { errors } = validateRegistry(reg);
      if (errors.length) throw new LedgerError('Invalid registry:\n  ' + errors.join('\n  '));
      writeJson(path.join(root, 'reviews', '.ledger', 'registry.json'), reg);
    } else if (sub !== 'show' && sub !== 'check') throw new LedgerError('registry takes: set | show | check');
    const ctx = loadContext(root, ctxOpts);
    const ev = evaluate(ctx);
    const empty = ev.cells.filter((c) => c.fileCount === 0).map((c) => c.id);
    const { order, cyclic } = topoOrder(ctx.registry);
    const warnings = [...empty.map((id) => `${id} matches no files`), ...(cyclic.length ? [`dependency cycle among: ${cyclic.join(', ')}`] : [])];
    if (sub === 'show') emit(ctx.registry, stableStringify(ctx.registry).trimEnd());
    else emit({ ok: true, modules: order, warnings }, `Registry OK: ${plural(order.length, 'module')}, ${plural(ev.cells.length, 'cell')}${warnings.length ? '\nWarnings:\n  - ' + warnings.join('\n  - ') : ''}`);
    return 0;
  }

  if (cmd === 'scan') {
    const s = scanProject(root);
    const aiLine = s.ai.no_ai_layer ? `AI signals: ${s.ai.sdk_in_manifests.length ? [...new Set(s.ai.sdk_in_manifests.map((x) => x.package))].join(', ') : plural(s.ai.ai_files, 'file')}${s.ai.ai_files ? `; ${plural(s.ai.ai_files, 'file')} import a model SDK or hold prompts` : ''}` : 'AI signals: none';
    emit(s, [`Root: ${s.root} (${s.git ? 'git, .gitignore honoured' : 'no git: default skip list'}) - ${plural(s.file_count, 'file')}`, `Manifests: ${s.manifests.join(', ') || 'none'}`, 'Top level:', ...s.top_level.map((t) => `  ${t.name.padEnd(24)} ${plural(t.files, 'file')}`), aiLine, ...s.ai.outside_ai_cells.sample.map((f) => '  ' + f)].join('\n'));
    return 0;
  }

  const ctx = loadContext(root, ctxOpts);

  if (cmd === 'coverage') {
    const ev = evaluate(ctx);
    const un = uncoveredFiles(ctx, ev);
    const ai = getAi(ctx, ev);
    emit({ cells: ev.cells.map((c) => ({ id: c.id, files: c.fileCount })), uncovered: un, ai }, [...ev.cells.map((c) => `  ${c.id.padEnd(28)} ${plural(c.fileCount, 'file')}${c.fileCount ? '' : '  (matches nothing)'}`), `Uncovered code or config files: ${un.count}`, ...un.sample.map((f) => '  ' + f), ...aiLines(ai), ...(ai.sdk_in_manifests.length ? ['AI packages in manifests: ' + [...new Set(ai.sdk_in_manifests.map((s) => s.package))].join(', ')] : [])].join('\n'));
    return 0;
  }
  if (cmd === 'plan') {
    const plan = buildPlan(ctx, evaluate(ctx), { scope: flags.scope, rerunAll: !!flags['rerun-all'], noDependents: !!flags['no-dependents'] });
    emit(plan, formatPlan(plan));
    return 0;
  }
  if (cmd === 'brief') {
    if (!pos[1]) throw new LedgerError('brief needs a cell id');
    if (flags.depth && !['quick', 'deep'].includes(flags.depth)) throw new LedgerError('--depth must be quick or deep');
    out(stableStringify(buildBrief(ctx, evaluate(ctx), pos[1], { rerunAll: !!flags['rerun-all'], depth: flags.depth })).trimEnd());
    return 0;
  }
  if (cmd === 'begin') {
    if (pos.length < 2) throw new LedgerError('begin needs at least one cell id');
    const ev = evaluate(ctx);
    for (const id of pos.slice(1)) beginCell(ctx, id, ev);
    out(`snapshot taken for ${pos.slice(1).join(', ')}`);
    return 0;
  }
  if (cmd === 'record') {
    if (!pos[1]) throw new LedgerError('record needs a cell id');
    const input = flags.findings ? parseJsonInput(flags.findings, 'findings') : {};
    const r = recordCell(ctx, pos[1], input, { kind: flags.kind, verdict: flags.verdict, depth: flags.depth, report: flags.report, blockRule: flags['block-rule'], incomplete: !!flags.incomplete, commit: flags.commit, ruleset: flags.ruleset });
    writeProgress(ctx);
    emit({ cell: pos[1], verdict: r.verdict, open: r.open, resolved: r.resolved, warnings: r.warnings }, `recorded ${pos[1]}: ${r.verdict} - open ${SEVERITIES.map((k) => `${k[0]}${r.open[k]}`).join(' ')} - resolved ${r.resolved}${r.warnings.map((w) => '\nwarning: ' + w).join('')}`);
    return 0;
  }
  if (cmd === 'import') {
    if (pos.length < 3) throw new LedgerError('import needs <cell> <sidecar-file>');
    const r = importCell(ctx, pos[1], pos[2], { report: flags.report, base: flags.base, assumeUnchanged: !!flags['assume-unchanged'], reviewedAt: flags['reviewed-at'], reviewedRuleset: flags['reviewed-ruleset'] });
    writeProgress(ctx);
    const i = r.imported;
    emit({ cell: pos[1], verdict: r.verdict, open: r.open, ...i, warnings: r.warnings },
      `imported ${pos[1]}: ${r.verdict} - open ${SEVERITIES.map((k) => `${k[0]}${r.open[k]}`).join(' ')} - ${plural(i.findings, 'finding')}${i.no_location ? `, ${i.no_location} with no file (kept; only a full re-review can resolve them)` : ''}${i.skipped.length ? `, skipped ${i.skipped.join(', ')}` : ''}\n  reviewed ${i.date}${i.commit ? ' at ' + i.commit : ''}; the code in the cell is unchanged since${r.warnings.map((w) => '\nwarning: ' + w).join('')}`);
    return 0;
  }
  if (cmd === 'accept') {
    if (pos.length < 3) throw new LedgerError('accept needs <cell> <finding-id>');
    acceptFinding(ctx, pos[1], pos[2], { reason: flags.reason, expires: flags.expires, days: flags.days ? Number(flags.days) : undefined, by: flags.by });
    writeProgress(ctx);
    out(`accepted ${pos[2]} in ${pos[1]}; it lapses if the file changes or after the expiry date`);
    return 0;
  }
  if (cmd === 'reopen') {
    if (pos.length < 3) throw new LedgerError('reopen needs <cell> <finding-id>');
    reopenFinding(ctx, pos[1], pos[2]);
    writeProgress(ctx);
    out(`reopened ${pos[2]} in ${pos[1]}`);
    return 0;
  }
  if (cmd === 'recheck') {
    if (!pos[1]) throw new LedgerError('recheck needs a cell id');
    const hints = recheck(ctx, pos[1]);
    emit(hints, hints.map((h) => `  ${h.id}  ${h.hint}  (${h.file})`).join('\n') || 'no open findings');
    return 0;
  }
  if (cmd === 'status') {
    const failOn = flags['fail-on'] ? SEV_ALIASES[String(flags['fail-on']).toLowerCase()] : undefined;
    if (flags['fail-on'] && !failOn) throw new LedgerError(`--fail-on must be one of ${SEVERITIES.join(', ')}`);
    const st = buildStatus(ctx, evaluate(ctx), { failOn, allowStale: !!flags['allow-stale'], strict: !!flags.strict });
    emit(st, formatStatus(st));
    return flags.check && !st.check.ok ? 1 : 0;
  }
  if (cmd === 'render') {
    out(`wrote ${posix(path.relative(process.cwd(), writeProgress(ctx))) || 'reviews/security-progress.md'}`);
    return 0;
  }
  if (cmd === 'prune') {
    const gone = pruneOrphans(ctx, evaluate(ctx));
    writeProgress(ctx);
    out(gone.length ? `removed: ${gone.join(', ')}` : 'nothing to prune');
    return 0;
  }
  throw new LedgerError(`Unknown command "${cmd}". Run: ledger.mjs help`);
}

function isMain() {
  try {
    return fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write((e instanceof LedgerError ? e.message : e.stack) + '\n');
    process.exitCode = e instanceof LedgerError ? e.exitCode : 2;
  }
}
