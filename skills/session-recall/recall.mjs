#!/usr/bin/env node
// recall.mjs — search past Claude Code sessions for this project.
// No external deps (no jq). Node >= 18.
//
// Verified against the real transcript schema:
//   one JSON object per line; .type in (user|assistant|ai-title|last-prompt|...)
//   .message.content is an ARRAY of blocks: {type:"text"|"thinking"|"tool_use"|"tool_result"}
// Only `text` blocks are ever searched or printed. tool_use/tool_result are never
// read into output — that is where file dumps and .env values live.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync as cpExecFile } from 'node:child_process';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const MAX_SNIPPET = 300;

// --quiet: degrade silently and exit 0 instead of erroring. Set by the SessionStart hook,
// where any stderr or non-zero exit would surface as a hook error on every session start.
let QUIET = false;

// Claude Code derives the folder name from cwd: ':' '\' '/' '_' '.' -> '-'
function slugFor(dir) {
  return dir.replace(/[:\\/_.]/g, '-');
}

// `base` overrides cwd. Hook handlers run in Claude Code's current directory, which is not
// guaranteed to be the project root — so the hook passes the root explicitly via --dir.
// Deliberately NOT reading CLAUDE_PROJECT_DIR by default: it is exported into every process
// Claude Code spawns, which would break `cd <other-project> && recall.mjs …`.
function resolveDir(all, base) {
  if (!fs.existsSync(ROOT)) fail(`No transcripts dir at ${ROOT}`);
  const dirs = fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory());
  if (all) return dirs.map((d) => path.join(ROOT, d));

  const root = path.resolve(base || process.cwd());
  const want = slugFor(root).toLowerCase();
  const hit = dirs.find((d) => d.toLowerCase() === want);
  if (hit) return [path.join(ROOT, hit)];

  fail(
    `No session folder for this project.\n  dir:      ${root}\n  expected: ${want}\n` +
      `  available:\n${dirs.map((d) => '    ' + d).join('\n')}\n` +
      `  (use --all to search every project)`
  );
}

function fail(msg) {
  if (!QUIET) {
    process.stderr.write(msg + '\n');
    process.exit(1);
  }
  process.exit(0);
}

// Parse one transcript into { title, mtime, turns:[{role,text}] }
function parseSession(file) {
  let title = null;
  const turns = [];
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === 'ai-title' && o.aiTitle) {
      title = o.aiTitle;
      continue;
    }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) turns.push({ role: o.type, text, ts: o.timestamp });
  }
  return { file, title, mtime: fs.statSync(file).mtime, turns };
}

function sessions(dirs) {
  const out = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.jsonl'))) {
      out.push(path.join(d, f));
    }
  }
  return out.sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime);
}

const fmt = (d) => d.toISOString().slice(0, 16).replace('T', ' ');
const proj = (f) => path.basename(path.dirname(f));

function cmdList(dirs, n = 20) {
  const files = sessions(dirs).slice(0, Number(n));
  for (const f of files) {
    const s = parseSession(f);
    if (!s) continue;
    console.log(`${fmt(s.mtime)}  ${proj(f)}  ${s.turns.length} turns`);
    console.log(`   ${s.title || '(untitled)'}`);
    console.log(`   ${path.basename(f)}`);
  }
  console.log(`\n${files.length} sessions.`);
}

// Ranked by number of matching turns, NOT by date. Date order buries the session
// where the work happened under every later session that merely mentioned it.
function cmdSearch(dirs, query, max = 8) {
  if (!query) fail('usage: recall.mjs search "<keyword>" [max]');
  const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const scored = [];
  for (const f of sessions(dirs)) {
    const s = parseSession(f);
    if (!s) continue;
    const hits = s.turns.filter((t) => rx.test(t.text));
    if (hits.length) scored.push({ s, f, hits, score: hits.length });
  }
  scored.sort((a, b) => b.score - a.score || b.s.mtime - a.s.mtime);

  for (const { s, f, hits, score } of scored.slice(0, Number(max))) {
    console.log(`=== ${fmt(s.mtime)}  ${proj(f)}  [${score} hits]  ${s.title || '(untitled)'}`);
    console.log(`    ${path.basename(f)}`);
    for (const h of hits.slice(0, 3)) {
      const i = h.text.search(rx);
      const from = Math.max(0, i - 80);
      const snip = h.text.slice(from, from + MAX_SNIPPET);
      console.log(`  [${h.role}] ${from ? '…' : ''}${snip}…`);
    }
    console.log('');
  }

  if (!scored.length) console.log(`No matches for "${query}".`);
  else
    console.log(
      `${Math.min(scored.length, Number(max))} of ${scored.length} matching session(s), ` +
        `ranked by hits. Reopen one with: claude --resume <id>`
    );
}

// Print one whole session as conversation text. Same filter as everything else —
// tool_use / tool_result are never emitted, so this stays safe on a 15MB transcript.
function cmdShow(dirs, id, perTurn = 2000, { onlyUser = false, budget = 40000 } = {}) {
  if (!id) fail('usage: recall.mjs show <session-id-prefix> [chars-per-turn]');
  const match = sessions(dirs).filter((f) => path.basename(f).startsWith(id));
  if (!match.length) fail(`No session starting with "${id}". Run: recall.mjs list`);
  if (match.length > 1) {
    fail(`Ambiguous "${id}" — matches:\n${match.map((f) => '  ' + path.basename(f)).join('\n')}`);
  }
  const f = match[0];
  const s = parseSession(f);
  if (!s) fail(`Could not parse ${f}`);

  const cap = Number(perTurn);
  const turns = onlyUser ? s.turns.filter((t) => t.role === 'user') : s.turns;
  const total = s.turns.reduce((n, t) => n + t.text.length, 0);

  console.log(`# ${s.title || '(untitled)'}`);
  console.log(`# ${proj(f)}  ${fmt(s.mtime)}  ${s.turns.length} text turns  ~${Math.round(total / 1000)}k chars`);
  console.log(`# raw file is ${(fs.statSync(f).size / 1048576).toFixed(1)}MB — this is the text-only view`);
  if (onlyUser) console.log(`# outline: ${turns.length} user turns only (what was asked, not answered)`);
  console.log('');

  // Hard output budget. A long session at a generous per-turn cap overflows the caller's
  // tool-output limit and gets spilled to a temp file, which defeats the point.
  let spent = 0;
  let printed = 0;
  for (const t of turns) {
    const body = t.text.length > cap ? t.text.slice(0, cap) + `\n… [+${t.text.length - cap} chars]` : t.text;
    if (spent + body.length > budget) break;
    console.log(`--- [${t.role}] ${t.ts || ''}`);
    console.log(body);
    console.log('');
    spent += body.length;
    printed++;
  }

  if (printed < turns.length) {
    console.log(
      `… stopped at ${printed}/${turns.length} turns (${Math.round(budget / 1000)}k char budget).\n` +
        `   Narrow it: 'outline ${id}' for questions only, a smaller chars-per-turn,\n` +
        `   or 'search "<keyword>"' to jump straight to the relevant part.`
    );
  }
}

// Dates + titles only, no conversation content. Called by the SessionStart hook so Claude
// knows what past work exists without having to be asked in the right words.
const SCAN_WINDOW = 30; // files parsed before giving up on filling `max` — bounds startup cost
const TITLE_CAP = 70;
const INTERRUPT = /^\[Request interrupted by user/;

// Our own pointer text. ONE constant, two jobs: printed by cmdMatch, and used to recognise
// that same output if it ever comes back at us as user text. Composing BANNER from
// BANNER_MARK is what keeps printing and filtering from drifting apart.
//
// Verified 2026-08-18 against this machine's transcripts: Claude Code records
// UserPromptSubmit output as `type:"attachment"` lines carrying no `message.content` at all,
// so hook output is invisible to parseSession and there is no feedback loop today. The only
// banner-bearing USER text turns in a 95-session corpus were a human pasting a pointer back
// into a prompt. This filter covers that, and fails safe on the day the schema starts
// recording hook output as a real turn.
const BANNER_MARK = 'already covered this ground';
const BANNER =
  `Earlier session(s) on this machine ${BANNER_MARK}. This is prior work on the same ` +
  'project, possibly by someone else who used this laptop — read before starting fresh.';
// The pointer's own field lines, so a pasted block is dropped whole and not just its header.
const OURS_LINE = /^\s*(overlaps|asked|ended):|^\s*Read one with: recall\.mjs/;
const isOurs = (t) => t.text.includes(BANNER_MARK);

// Topic keywords turn the startup index into a retrieval hook: when a later question
// mentions a term listed here, the relevant session is already visible in context and no
// one has to run `search` first. Extracted from user turns only — the ask carries the
// topic, assistant prose dilutes it. Costs nothing extra to gather: parseSession has
// already read and split this text.
const STOP = new Set(
  `the a an and or but if then than that this these those with without from into onto for
to of in on at by as is are was were be been being do does did doing have has had can
could should would will shall may might must not no yes you your we our us it its they
them their what when where which who why how all any both each few more most other some
such only own same so too very just now also here there over under again once about above
below out off up down get got make made use used using need want like know think see look
add new old file files code line lines run running ran please thanks ok okay let lets try
trying help work works working thing things way ways good bad right wrong sure done next
last first still even much many one two three because while after before during`.split(/\s+/)
);

// camelCase, snake_case, dotted/pathed names and ACRONYMS are far likelier to be the
// actual subject than an ordinary English word, so they clear the threshold on one hit.
const IDENTISH = /[a-z][A-Z]|_|[./-]|^[A-Z]{2,}$/;

function keywordsFor(turns, n = 6) {
  const counts = new Map();
  const casing = new Map();
  for (const t of turns) {
    if (t.role !== 'user') continue;
    if (INTERRUPT.test(t.text)) continue; // marker text, not something the user typed
    if (isOurs(t)) continue; // our own pointer pasted back in — our vocabulary, not theirs
    for (const raw of t.text.match(/[A-Za-z_][A-Za-z0-9_./-]{2,}/g) || []) {
      const tok = raw.replace(/^[./-]+|[./-]+$/g, ''); // trailing sentence punctuation
      if (tok.length < 3) continue;
      if (/^[0-9a-f-]{8,}$/i.test(tok)) continue; // uuids, hashes, session ids
      const k = tok.toLowerCase();
      if (STOP.has(k) || k.length > 40) continue;
      if (!casing.has(k)) casing.set(k, tok);
      counts.set(k, (counts.get(k) || 0) + (IDENTISH.test(tok) ? 3 : 1));
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => casing.get(k));
}

// self comes from the hook's stdin payload when there is one. Same bug cmdMatch had: with
// env-only identification the session being started can list itself, and the env var is not
// guaranteed — the transcript path on stdin is.
function cmdIndex(dirs, max = 12, { self: selfArg = null } = {}) {
  const self =
    selfArg ||
    (process.env.CLAUDE_CODE_SESSION_ID ? `${process.env.CLAUDE_CODE_SESSION_ID}.jsonl` : null);

  const files = sessions(dirs).filter((f) => path.basename(f) !== self);
  const kept = [];

  for (const f of files.slice(0, SCAN_WINDOW)) {
    if (kept.length >= Number(max)) break;
    const s = parseSession(f);
    if (!s) continue;

    // Interrupt markers are ordinary user text turns; they inflate the count.
    const turns = s.turns.filter((t) => !(t.role === 'user' && INTERRUPT.test(t.text))).length;
    if (turns === 0) continue; // aborted session — pure noise in an index
    if (!s.title && turns < 4) continue; // untitled AND trivial — nothing to offer

    kept.push({ f, turns, title: s.title, mtime: s.mtime, topics: keywordsFor(s.turns) });
  }

  if (!kept.length) return; // brand-new project: inject nothing at all

  const out = [
    'Saved Claude Code sessions for this project (index only: dates, titles and sizes — ' +
      'no conversation content is included here).',
    '',
  ];
  for (const k of kept) {
    const id = path.basename(k.f).slice(0, 8);
    const t = (k.title || '(untitled)').replace(/\s+/g, ' ').slice(0, TITLE_CAP);
    out.push(`  ${fmt(k.mtime)}  ${id}  ${String(k.turns).padStart(3)} turns  ${t}`);
    if (k.topics.length) out.push(`      topics: ${k.topics.join(', ')}`);
  }
  out.push('');
  out.push(
    kept.length < files.length
      ? `Showing the ${kept.length} most recently active of ${files.length} saved sessions; empty sessions are omitted.`
      : `${kept.length} saved session(s), most recently active first.`
  );
  out.push('Dates are last activity, not session start. Titles are auto-generated and approximate.');
  out.push('Topics are frequent terms from the user turns — retrieval hooks, not summaries.');
  out.push('The session-recall skill reads these on request: `outline <id>` for the questions asked,');
  out.push('`show <id>` for the full conversation, `search "<keyword>"` across all of them.');
  console.log(out.join('\n'));
}

// --- topic-overlap matching -------------------------------------------------
// The case this exists for: someone opens a fresh session and asks a perfectly
// ordinary forward-looking question ("how do I wire up X?"), not knowing the same
// ground was covered here weeks ago. There is no recall cue in that sentence to
// trigger on, so we match their words against past sessions' topics instead.
const CACHE = '.recall-topics.json';
// v4: banner filtering. A finished session that ever received a pasted pointer keeps its
// pre-filter topics forever — only live sessions re-parse on mtime — so every entry has to be
// rebuilt once. One ~0.8s reparse across the corpus.
const CACHE_V = 4; // bump to invalidate every cached entry after a shape change

// Parsing every transcript costs seconds; a prompt hook has milliseconds. Cache
// keyed on mtime so only new or edited sessions are ever re-read.
// Transcript text can contain things the user pasted in — tokens, keys, connection
// strings. A pointer was safe by construction; quoting turn text is not, so anything
// key-shaped is scrubbed once at cache-build time and never reaches the prompt.
const SECRET_PATTERNS = [
  /(sk-|ghp_|gho_|ghs_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{10,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /(bearer|token|api[_-]?key|apikey|password|passwd|secret|client[_-]?secret)([\s:=]{1,4})\S{6,}/gi,
];

function redact(text) {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

function gistOf(turns, cap = 200) {
  const clean = turns.filter((t) => !INTERRUPT.test(t.text) && !isOurs(t));
  const firstUser = clean.find((t) => t.role === 'user');
  const lastAsst = [...clean].reverse().find((t) => t.role === 'assistant');
  const trim = (t) => {
    if (!t) return '';
    const s = redact(t.text).replace(/\s+/g, ' ').trim();
    return s.length > cap ? s.slice(0, cap - 1) + '\u2026' : s;
  };
  return { ask: trim(firstUser), outcome: trim(lastAsst) };
}

// Lexical matching only fires when the wording happens to line up: paraphrase a session's
// own subject and it finds nothing. Aliases close that gap without putting a model in the
// hot path — generated ONCE per session at cache-build time, then matched as plain words.
//
// Spawning `claude -p` starts a session, which fires SessionStart, which runs this script
// again. RECALL_NO_ENRICH stops that recursion: the child inherits it and never enriches.
const NO_ENRICH = 'RECALL_NO_ENRICH';

function aliasesFor(entry) {
  if (process.env[NO_ENRICH]) return [];
  const subject = (entry.topics || []).slice(0, 8).join(' ');
  const prompt =
    'Reply with ONLY a JSON array of 10 lowercase alias keywords a developer might use to ' +
    'describe this work in different words. No prose, no code fences. ' +
    'title="' + (entry.title || '') + '" subject="' + subject + '"';
  let out;
  try {
    out = cpExecFile('claude', ['-p', prompt, '--model', 'haiku'], {
      encoding: 'utf8',
      timeout: 90000,
      maxBuffer: 1 << 20,
      cwd: os.tmpdir(),
      env: { ...process.env, [NO_ENRICH]: '1' },
    });
  } catch {
    return []; // no CLI, not logged in, timeout — fall back to lexical only
  }
  const i = out.indexOf('[');
  const j = out.lastIndexOf(']');
  if (i < 0 || j < i) return [];
  let raw;
  try {
    raw = JSON.parse(out.slice(i, j + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  // Keep the phrase AND its parts: a query saying "end to end" should still reach an
  // alias stored as "e2e-testing".
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const phrase = item.toLowerCase().trim();
    if (phrase.length >= 3 && phrase.length <= 40) seen.add(phrase);
    for (const part of phrase.split(/[^a-z0-9]+/)) {
      if (part.length >= 3 && !STOP.has(part) && !GENERIC.has(part)) seen.add(part);
    }
  }
  return [...seen].slice(0, 20);
}

function buildCache(dirs, { enrich = 0 } = {}) {
  const cacheFile = path.join(dirs[0], CACHE);
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    prev = {};
  }
  const store = {};
  let parsed = 0;
  for (const f of sessions(dirs)) {
    const key = path.basename(f);
    const mt = fs.statSync(f).mtimeMs;
    if (prev[key] && prev[key].mtime === mt && prev[key].v === CACHE_V) {
      store[key] = prev[key];
      continue;
    }
    const s = parseSession(f);
    if (!s) continue;
    parsed++;
    const turns = s.turns.filter((t) => !(t.role === 'user' && INTERRUPT.test(t.text))).length;
    if (!turns) continue;
    store[key] = {
      mtime: mt,
      v: CACHE_V,
      date: fmt(s.mtime),
      title: s.title || '',
      turns,
      topics: keywordsFor(s.turns, 14),
      // Counted, not silently discarded: if this total ever jumps, the transcript schema
      // changed and hook output is landing in real turns. Surfaced by `recall.mjs banners`.
      banner: s.turns.filter(isOurs).length,
      ...gistOf(s.turns),
      aliases: [],
    };
  }
  // Only a few per run: a first build over ~90 sessions must not stall a session start.
  // The backlog fills in over subsequent sessions, or all at once via the enrich command.
  let budget = Number(enrich) || 0;
  for (const e of Object.values(store)) {
    if (budget <= 0) break;
    if (e.turns < 6 || (e.aliases && e.aliases.length)) continue;
    e.aliases = aliasesFor(e);
    budget--;
  }

  try {
    fs.writeFileSync(cacheFile, JSON.stringify(store));
  } catch {
    /* read-only home: matching still works, it just re-parses next time */
  }
  return { store, parsed };
}

// Unlike keywordsFor there is no repetition threshold here — a prompt mentions its
// subject once, and that single mention is the whole signal.
// Words common to half the sessions in any repo. They are fine as stored topics but
// worthless as evidence of continuity — matching on them produced hits like
// "fix, error" against unrelated bug-fix sessions.
const GENERIC = new Set(
  (`fix fixes fixed error errors bug bugs issue issues problem add added update updated
change changed create created delete remove review check checks test tests setup set
project session sessions question task tasks feature support enable disable build make
write read show list find search implement implementation why how what want should
user users name names type types result results return data value values page pages
thing stuff current new old best good better`).split(/[^A-Za-z]+/).filter(Boolean)
);
function queryTerms(text) {
  const out = new Map();
  for (const raw of text.match(/[A-Za-z_][A-Za-z0-9_./-]{2,}/g) || []) {
    const tok = raw.replace(/^[./-]+|[./-]+$/g, '');
    if (tok.length < 3) continue;
    const k = tok.toLowerCase();
    if (STOP.has(k)) continue;
    if (GENERIC.has(k)) continue;
    if (/^[0-9a-f-]{8,}$/i.test(tok)) continue;
    out.set(k, IDENTISH.test(tok) ? 3 : 1);
  }
  return out;
}

function cmdMatch(dirs, text, max = 3, { self: selfArg = null } = {}) {
  if (!text) fail('match needs text: recall.mjs match "<prompt text>" [max]');
  // A pasted pointer is our own wording, not the user's. Scoring on it re-matches the very
  // session we already pointed at.
  const cleanText = String(text)
    .split('\n')
    .filter((l) => !l.includes(BANNER_MARK) && !OURS_LINE.test(l))
    .join('\n');
  const q = queryTerms(cleanText);
  if (!q.size) return;

  // The live session shares all of the current prompt's vocabulary, so it matches strongly
  // and buries real prior work; its mtime also changes every turn, so it misses the cache and
  // is fully re-parsed on every prompt as it grows toward 15MB. Hooks are handed the current
  // session on stdin — the env var is only a fallback for manual CLI runs.
  const self =
    selfArg ||
    (process.env.CLAUDE_CODE_SESSION_ID ? process.env.CLAUDE_CODE_SESSION_ID + '.jsonl' : null);
  const { store } = buildCache(dirs);

  // Rarity is measured from the corpus, not hand-maintained: "playwright" (2 sessions)
  // is strong evidence, "skill" (7) is weak, and a flat weight cannot tell them apart.
  const df = new Map();
  for (const s2 of Object.values(store)) {
    const bag = [...(s2.topics || []), ...(s2.aliases || [])];
    for (const t of new Set(bag.map((x) => x.toLowerCase()))) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const rarity = (t) => { const d = df.get(t) || 0; return d <= 2 ? 2 : d <= 5 ? 1.5 : 1; };
  for (const [term, w] of q) q.set(term, w * rarity(term));

  const scored = [];
  for (const [key, s] of Object.entries(store)) {
    if (key === self) continue;
    const topics = new Set((s.topics || []).map((t) => t.toLowerCase()));
    const aliases = new Set((s.aliases || []).map((t) => t.toLowerCase()));
    const titleWords = new Set(
      (s.title || '').toLowerCase().split(/[^A-Za-z0-9_.-]+/).filter(Boolean)
    );
    let score = 0;
    const hits = [];
    for (const [term, w] of q) {
      const inAlias = aliases.has(term);
      const inTopics = topics.has(term);
      const inTitle = titleWords.has(term);
      if (!inTopics && !inTitle && !inAlias) continue;
      // An alias is a deliberate semantic marker for this session, so it carries the same
      // weight as a title hit. At x1 it could never clear a threshold calibrated for titles.
      score += w * (inTitle || inAlias ? 2 : 1);
      hits.push(term);
    }
    // Two ordinary shared words are coincidence. Accept either strong evidence (an
    // identifier-shaped term, or several title hits) or a broad overlap of weak terms.
    if (hits.length >= 2 && score >= 6) scored.push({ key, s, score, hits });
  }
  if (!scored.length) return;

  // Tie-break toward the longer session: where two match equally well, the one that ran
  // 400 turns is where the work happened, not the one that ran 1.
  scored.sort((a, b) => b.score - a.score || b.s.turns - a.s.turns);
  const top = scored.slice(0, Number(max) || 3);

  console.log(BANNER);
  for (const { key, s, hits } of top) {
    const id = key.slice(0, 8);
    console.log('  ' + s.date + '  ' + id + '  ' + String(s.turns).padStart(3) + ' turns  ' + (s.title || '(untitled)'));
    console.log('      overlaps: ' + hits.slice(0, 8).join(', '));
    if (s.ask) console.log('      asked: ' + s.ask);
    // In a short session the final reply is usually incidental, not a conclusion — only
    // quote it once the conversation was long enough to have arrived somewhere.
    if (s.outcome && s.turns >= 6) console.log('      ended: ' + s.outcome);
  }
  console.log('Read one with: recall.mjs outline <id>   (then search "<term>" for detail)');
}

// Hook payloads arrive as JSON on stdin. Read it ONLY when the caller says so: a bare
// readFileSync(0) blocks until EOF when stdin is an idle terminal or an inherited pipe,
// which would hang a manual CLI run.
function stdinPayload(enabled) {
  if (!enabled) return {};
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

// slugFor can never match a path Claude Code hashed, or one containing any character beyond
// `: \\ / _ .` — it replaces ALL non-alphanumerics with '-' and truncates long paths with a
// hash suffix, so exact match is unreachable for those. Hooks are handed transcript_path,
// which IS a file inside the right folder, so there is nothing to derive. slugFor stays only
// as the fallback for manual CLI invocation.
function dirsFromPayload(payload, { all = false, baseDir = null } = {}) {
  const tp = payload.transcript_path || payload.transcriptPath;
  if (tp) {
    try {
      const d = path.dirname(path.resolve(tp));
      if (fs.statSync(d).isDirectory()) return [d];
    } catch {
      /* fall through to the slug guess */
    }
  }
  return resolveDir(all, baseDir); // QUIET on the hook path: exits 0, prints nothing
}

// The transcript's own filename IS the current session — always present, and not dependent on
// an env var being exported. session_id is the documented field; keep it as the fallback.
function selfFileFrom(payload) {
  const tp = payload.transcript_path || payload.transcriptPath;
  if (tp) return path.basename(tp);
  if (payload.session_id) return payload.session_id + '.jsonl';
  return process.env.CLAUDE_CODE_SESSION_ID ? process.env.CLAUDE_CODE_SESSION_ID + '.jsonl' : null;
}

// Entry point for the UserPromptSubmit hook: the harness feeds the prompt as JSON on
// stdin. Anything printed to stdout is injected as context for that turn. Never throws —
// a recall failure must not block the prompt.
function cmdHook({ all = false, baseDir = null } = {}) {
  const payload = stdinPayload(true);
  const text = payload.prompt || payload.user_prompt || '';
  if (!text || text.length < 12) return; // too short to carry a topic
  try {
    const dirs = dirsFromPayload(payload, { all, baseDir });
    if (!dirs) return;
    cmdMatch(dirs, text, 3, { self: selfFileFrom(payload) });
  } catch {
    /* stay silent rather than break the turn */
  }
}
// --- summary cards -----------------------------------------------------------------
// Word frequency does not carry meaning: a session that typed "tailwind" for 200 turns stores
// no term resembling "colour palette", so a paraphrase can never reach it. A card replaces the
// stored representation with three sentences of prose plus deliberate search terms, written
// once per session by a model that has actually seen the conversation.
//
// Cards live OUTSIDE the transcript folder. Claude Code's cleanupPeriodDays sweep deletes
// transcripts (30 days by default) and does not touch ~/.claude/recall/, so a card outlives the
// conversation it came from — which is the entire point. One file per session also removes the
// shared-cache write race: no reader ever mutates another writer's file.
const CARDS = path.join(os.homedir(), '.claude', 'recall');
const CARD_TURNS_MIN = 4; // below this a session has not said enough to summarise
const EXCERPT_CAP = 400; // chars per quoted turn

const cardDirFor = (file) => path.join(CARDS, path.basename(path.dirname(file)));
const cardPathFor = (file) =>
  path.join(cardDirFor(file), path.basename(file).replace(/\.jsonl$/, '') + '.md');

// The transcript mtime the card was built from. Lets a re-run skip unchanged sessions without
// re-reading the transcript or paying for another model call.
function cardMtime(cardFile) {
  try {
    const m = fs.readFileSync(cardFile, 'utf8').match(/^mtime:\s*(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// Which path wrote this card. A fallback card is a placeholder, not a result: if Haiku was
// rate-limited or logged out mid-backfill, the mtime check alone would report 'unchanged'
// forever and that session would keep its thin card permanently. --upgrade targets exactly
// these, ignoring mtime.
function cardSource(cardFile) {
  try {
    const m = fs.readFileSync(cardFile, 'utf8').match(/^source:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// What the model is shown. Text blocks only, so tool output and file dumps cannot reach it.
// User turns carry the intent; the last assistant turn is where the session landed. Sampling
// the middle catches the pivot — sessions routinely end up somewhere unrelated to their opening
// question, and a head-and-tail excerpt alone would miss it entirely.
function excerptFor(session) {
  const clip = (t) => {
    const x = redact(t.text).replace(/\s+/g, ' ').trim();
    return x.length > EXCERPT_CAP ? x.slice(0, EXCERPT_CAP - 1) + '…' : x;
  };
  const users = session.turns.filter(
    (t) => t.role === 'user' && !INTERRUPT.test(t.text) && !isOurs(t)
  );
  const asst = session.turns.filter((t) => t.role === 'assistant' && !isOurs(t));

  const head = users.slice(0, 3);
  const rest = users.slice(3);
  const mid = [];
  if (rest.length) {
    const k = Math.min(5, rest.length);
    for (let i = 0; i < k; i++) mid.push(rest[Math.floor(((i + 0.5) * rest.length) / k)]);
  }

  const parts = [];
  head.forEach((t, i) => parts.push('[user ' + (i + 1) + '] ' + clip(t)));
  mid.forEach((t, i) => parts.push('[user, mid-session ' + (i + 1) + '] ' + clip(t)));
  if (asst.length) parts.push('[assistant, final] ' + clip(asst[asst.length - 1]));
  return parts.join('\n');
}

// ONE model call per session. Returns null on any failure — missing CLI, not logged in,
// timeout, non-JSON reply — and the caller writes a fallback card instead of nothing.
function summariseSession(title, turns, excerpt) {
  const prompt =
    'Summarise this developer coding session so a teammate can FIND it later by keyword.\n' +
    'Reply with ONLY a JSON object. No prose, no code fences.\n' +
    '{"summary":"<exactly 3 sentences: what was attempted, what was decided, where it landed>",' +
    '"topics":["<12 lowercase words a developer would search for>"]}\n' +
    'Topics must be concrete things actually at stake — library names, screen or file names, ' +
    'domain terms, the technology used. Never generic words like fix, error, update, code, ' +
    'session, project. Include the plain-English words someone would use who does not know the ' +
    'tool names (e.g. both "playwright" and "browser", both "tailwind" and "colour").\n\n' +
    'TITLE: ' + title + '\nTURNS: ' + turns + '\n\nEXCERPT:\n' + excerpt;

  let out;
  try {
    out = cpExecFile('claude', ['-p', prompt, '--model', 'haiku'], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 1 << 20,
      cwd: os.tmpdir(),
      env: { ...process.env, [NO_ENRICH]: '1' },
    });
  } catch {
    return null;
  }
  const i = out.indexOf('{');
  const j = out.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  let o;
  try {
    o = JSON.parse(out.slice(i, j + 1));
  } catch {
    return null;
  }
  const summary = typeof o.summary === 'string' ? o.summary.replace(/\s+/g, ' ').trim() : '';
  const topics = Array.isArray(o.topics)
    ? [
        ...new Set(
          o.topics
            .filter((t) => typeof t === 'string')
            .map((t) => t.toLowerCase().trim())
            .filter((t) => t.length >= 3 && t.length <= 40)
        ),
      ].slice(0, 12)
    : [];
  if (!summary || !topics.length) return null;
  return { summary, topics };
}

// redact() runs over the model's output too, not just the excerpt: a summary can echo back a
// key the user pasted mid-session, and the card is what Step 4 injects into prompts.
function writeCard(file, session, turns, data, source) {
  const dir = cardDirFor(file);
  fs.mkdirSync(dir, { recursive: true });
  const out = cardPathFor(file);
  const body =
    [
      '# ' + (session.title || '(untitled)'),
      'session: ' + path.basename(file).replace(/\.jsonl$/, ''),
      'date: ' + fmt(session.mtime),
      'turns: ' + turns,
      // Rounded: Windows reports a fractional mtimeMs, and a card storing '…173.376'
      // never compares equal to the integer the freshness check reads back, so every run
      // would re-summarise it and pay for another model call.
      'mtime: ' + Math.round(fs.statSync(file).mtimeMs),
      'source: ' + source,
      '',
      '## Summary',
      redact(data.summary),
      '',
      '## Topics',
      data.topics.map(redact).join(', '),
      '',
    ].join('\n');
  // tmp + rename: a reader never sees a half-written card.
  const tmp = out + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, out);
  return out;
}

// Returns a status string, never throws. 'short' | 'unchanged' | 'model' | 'fallback' | 'error'
function digestOne(file, { force = false } = {}) {
  try {
    const card = cardPathFor(file);
    if (!force && fs.existsSync(card) && cardMtime(card) === Math.round(fs.statSync(file).mtimeMs)) {
      return 'unchanged';
    }
    const session = parseSession(file);
    if (!session) return 'error';
    const turns = session.turns.filter(
      (t) => !(t.role === 'user' && INTERRUPT.test(t.text))
    ).length;
    if (turns < CARD_TURNS_MIN) return 'short';

    const title = session.title || '(untitled)';
    const data = summariseSession(title, turns, excerptFor(session));
    if (data) {
      writeCard(file, session, turns, data, 'haiku');
      return 'model';
    }
    // A title plus the session's own frequent terms is thin, but it is findable, and a missing
    // card is not. Marked so a later run can tell the two apart and upgrade it.
    const terms = keywordsFor(session.turns, 12).map((t) => t.toLowerCase());
    writeCard(
      file,
      session,
      turns,
      {
        summary:
          'No model summary available for this session; card built from its title and most ' +
          'frequent terms. Title: "' + title + '". ' + turns + ' turns.',
        topics: terms.length
          ? terms
          : title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
      },
      'fallback'
    );
    return 'fallback';
  } catch {
    return 'error';
  }
}

// No timer-free sleep exists in Node's stdlib without a dep; Atomics.wait blocks the thread for
// a fixed span with no packages and no event loop involvement.
function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable: proceed without the gap */
  }
}

// Deliberately walks EVERY session, not SCAN_WINDOW. The window bounds what the startup index
// prints; applying it here would silently leave the oldest — and often largest — sessions
// permanently uncarded, which is exactly the invisibility this is meant to fix.
function cmdDigest(dirs, { id = null, backfill = null, force = false, upgrade = false } = {}) {
  if (process.env[NO_ENRICH]) return; // `claude -p` is itself a session: this stops the recursion

  const all = sessions(dirs); // newest first
  let targets;
  if (upgrade) {
    targets = all.filter((f) => cardSource(cardPathFor(f)) === 'fallback');
    console.log(targets.length + ' fallback card(s) to re-try, of ' + all.length + ' session(s).');
    force = true; // their mtime has not changed; the card being thin is the reason to redo it
  } else if (backfill !== null) {
    const n = Number(backfill) || all.length;
    targets = all.filter((f) => !fs.existsSync(cardPathFor(f))).slice(0, n);
    console.log(targets.length + ' session(s) without a card, of ' + all.length + ' total.');
  } else if (id) {
    targets = all.filter((f) => path.basename(f).startsWith(id));
    if (!targets.length) {
      console.log('No session starting with "' + id + '".');
      return;
    }
  } else {
    return;
  }

  const tally = { model: 0, fallback: 0, unchanged: 0, short: 0, error: 0 };
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    const r = digestOne(f, { force });
    tally[r] = (tally[r] || 0) + 1;
    console.log('  [' + (i + 1) + '/' + targets.length + '] ' + path.basename(f).slice(0, 8) + '  ' + r);
    if (i < targets.length - 1 && (r === 'model' || r === 'fallback')) sleepMs(1000);
  }
  console.log(
    'cards: ' + tally.model + ' from model, ' + tally.fallback + ' fallback, ' +
      tally.unchanged + ' already current, ' + tally.short + ' too short, ' +
      tally.error + ' failed — stored in ' + CARDS
  );
}

// Kept OUT of the SessionStart path on purpose: a model call inside a 20s hook can blow the
// timeout and cost the user the startup listing entirely. Run it explicitly instead.
function cmdEnrich(dirs, n = 5) {
  const { store } = buildCache(dirs, { enrich: Number(n) || 5 });
  const all = Object.values(store);
  const done = all.filter((e) => (e.aliases || []).length).length;
  const todo = all.filter((e) => e.turns >= 6 && !(e.aliases || []).length).length;
  const banner = all.reduce((n, e) => n + (e.banner || 0), 0);
  console.log(done + " of " + all.length + " sessions have aliases; " + todo + " still to do");
  console.log(banner + " banner-bearing text turn(s) filtered (see: recall.mjs banners)");
}

// Visibility for the banner filter. Today this must print 0 for every finished session; a
// non-zero count on a session nobody pasted into means hook output is being recorded as a
// real turn, and the filter is the only thing between us and a feedback loop.
function cmdBanners(dirs) {
  const { store } = buildCache(dirs);
  const rows = Object.entries(store).filter(([, e]) => (e.banner || 0) > 0);
  let total = 0;
  for (const [key, e] of rows) {
    total += e.banner;
    console.log(
      `  ${e.date}  ${key.slice(0, 8)}  ${String(e.banner).padStart(3)} banner turn(s)  ` +
        (e.title || '(untitled)')
    );
  }
  console.log(
    `${total} banner-bearing text turn(s) across ${rows.length} of ${Object.keys(store).length} ` +
      'session(s) — filtered out of topics and gists, not dropped silently.'
  );
}

const [, , cmd, ...rest] = process.argv;
let all = false;
let baseDir = null;
let useStdin = false;
let force = false;
let upgrade = false;
let backfill = null;
const args = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--all') all = true;
  else if (a === '--quiet') QUIET = true;
  else if (a === '--stdin') useStdin = true;
  else if (a === '--force') force = true;
  else if (a === '--upgrade') upgrade = true;
  else if (a === '--backfill') {
    backfill = /^\d+$/.test(rest[i + 1] || '') ? rest[++i] : '';
  } else if (a.startsWith('--backfill=')) backfill = a.slice(11);
  else if (a === '--dir') baseDir = rest[++i];
  else if (a.startsWith('--dir=')) baseDir = a.slice(6);
  else args.push(a);
}
// If the hook harness ever fails to expand ${CLAUDE_PROJECT_DIR}, we get the literal
// placeholder. The same value is also exported as an env var — fall back to it.
if (baseDir && baseDir.includes('${')) baseDir = process.env.CLAUDE_PROJECT_DIR || null;

// resolveDir() calls fail() -> stderr + exit 1, and it runs before dispatch, so on the hook
// path a resolution failure surfaced as a hook error on EVERY prompt where cmdHook's
// try/catch could never see it. The hook is quiet by construction now, and resolves its own
// folder from stdin after the payload has been read.
const HOOK_ONLY = cmd === 'hook';
// digest runs from a SessionEnd hook as well as by hand. Quiet either way: a failed card
// must never make session exit look broken.
if (HOOK_ONLY || cmd === 'digest') QUIET = true;
// Neither hook resolves here. Both are handed their folder on stdin, and resolveDir() exits
// the process on failure -- under QUIET that exit is silent, so a SessionEnd digest launched
// from a cwd outside the project died before it began. Resolve lazily, inside the branch that
// actually needs a guess.
const dirs = HOOK_ONLY || cmd === 'digest' ? null : resolveDir(all, baseDir);

if (HOOK_ONLY) {
  try {
    cmdHook({ all, baseDir });
  } catch {
    /* a recall failure must never break a prompt */
  }
  process.exit(0);
}

if (cmd === 'digest') {
  try {
    const payload = stdinPayload(useStdin);
    const tp = payload.transcript_path || payload.transcriptPath;
    // The SessionEnd hook names the session it is ending; a manual run names it by prefix.
    const one = args[0] || (tp ? path.basename(tp).replace(/\.jsonl$/, '') : null);
    const where = tp ? [path.dirname(path.resolve(tp))] : resolveDir(all, baseDir);
    cmdDigest(where, { id: upgrade ? null : one, backfill, force, upgrade });
  } catch {
    /* never break session exit */
  }
  process.exit(0);
}

if (cmd === 'list') cmdList(dirs, args[0]);
else if (cmd === 'search') cmdSearch(dirs, args[0], args[1]);
else if (cmd === 'show') cmdShow(dirs, args[0], args[1] || 2000);
else if (cmd === 'outline') cmdShow(dirs, args[0], args[1] || 200, { onlyUser: true });
else if (cmd === 'index')
  cmdIndex(dirs, args[0], { self: selfFileFrom(stdinPayload(useStdin)) });
else if (cmd === 'match') cmdMatch(dirs, args[0], args[1]);
else if (cmd === 'enrich') cmdEnrich(dirs, args[0]);
else if (cmd === 'banners') cmdBanners(dirs);
else
  fail(
    'usage:\n' +
      '  recall.mjs list [n] [--all]\n' +
      '  recall.mjs search "<kw>" [max] [--all]\n' +
      '  recall.mjs outline <session-id-prefix> [chars-per-turn]   # questions only, start here\n' +
      '  recall.mjs show <session-id-prefix> [chars-per-turn]      # full conversation\n' +
      '  recall.mjs index [n] [--dir <path>] [--quiet]             # titles+dates only, for hooks' +
      '\n  recall.mjs match "<text>" [max]                        # sessions whose topics overlap <text>' +
      '\n  recall.mjs banners                                       # sessions carrying our own pointer text' +
      '\n  recall.mjs digest [<id>] [--stdin] [--force]              # write one summary card' +
      '\n  recall.mjs digest --backfill [n]                          # card every session lacking one' +
      '\n  recall.mjs digest --upgrade                               # re-try only source: fallback cards'
  );
