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

function cmdIndex(dirs, max = 12) {
  const self = process.env.CLAUDE_CODE_SESSION_ID
    ? `${process.env.CLAUDE_CODE_SESSION_ID}.jsonl`
    : null;

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
const CACHE_V = 2; // bump to invalidate every cached entry after a shape change

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
  const clean = turns.filter((t) => !INTERRUPT.test(t.text));
  const firstUser = clean.find((t) => t.role === 'user');
  const lastAsst = [...clean].reverse().find((t) => t.role === 'assistant');
  const trim = (t) => {
    if (!t) return '';
    const s = redact(t.text).replace(/\s+/g, ' ').trim();
    return s.length > cap ? s.slice(0, cap - 1) + '\u2026' : s;
  };
  return { ask: trim(firstUser), outcome: trim(lastAsst) };
}

function buildCache(dirs) {
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
      ...gistOf(s.turns),
    };
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

function cmdMatch(dirs, text, max = 3) {
  if (!text) fail('match needs text: recall.mjs match "<prompt text>" [max]');
  const q = queryTerms(text);
  if (!q.size) return;

  const self = process.env.CLAUDE_CODE_SESSION_ID
    ? process.env.CLAUDE_CODE_SESSION_ID + '.jsonl'
    : null;
  const { store } = buildCache(dirs);

  // Rarity is measured from the corpus, not hand-maintained: "playwright" (2 sessions)
  // is strong evidence, "skill" (7) is weak, and a flat weight cannot tell them apart.
  const df = new Map();
  for (const s2 of Object.values(store)) {
    for (const t of new Set((s2.topics || []).map((x) => x.toLowerCase()))) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const rarity = (t) => { const d = df.get(t) || 0; return d <= 2 ? 2 : d <= 5 ? 1.5 : 1; };
  for (const [term, w] of q) q.set(term, w * rarity(term));

  const scored = [];
  for (const [key, s] of Object.entries(store)) {
    if (key === self) continue;
    const topics = new Set((s.topics || []).map((t) => t.toLowerCase()));
    const titleWords = new Set(
      (s.title || '').toLowerCase().split(/[^A-Za-z0-9_.-]+/).filter(Boolean)
    );
    let score = 0;
    const hits = [];
    for (const [term, w] of q) {
      const inTopics = topics.has(term);
      const inTitle = titleWords.has(term);
      if (!inTopics && !inTitle) continue;
      score += w * (inTitle ? 2 : 1);
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

  console.log(
    'Earlier session(s) on this machine already covered this ground. This is prior work on ' +
      'the same project, possibly by someone else who used this laptop — read before starting fresh.'
  );
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

// Entry point for the UserPromptSubmit hook: the harness feeds the prompt as JSON on
// stdin. Anything printed to stdout is injected as context for that turn. Never throws —
// a recall failure must not block the prompt.
function cmdHook(dirs) {
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  const text = payload.prompt || payload.user_prompt || "";
  if (!text || text.length < 12) return; // too short to carry a topic
  try {
    cmdMatch(dirs, text, 3);
  } catch {
    /* stay silent rather than break the turn */
  }
}
const [, , cmd, ...rest] = process.argv;
let all = false;
let baseDir = null;
const args = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--all') all = true;
  else if (a === '--quiet') QUIET = true;
  else if (a === '--dir') baseDir = rest[++i];
  else if (a.startsWith('--dir=')) baseDir = a.slice(6);
  else args.push(a);
}
// If the hook harness ever fails to expand ${CLAUDE_PROJECT_DIR}, we get the literal
// placeholder. The same value is also exported as an env var — fall back to it.
if (baseDir && baseDir.includes('${')) baseDir = process.env.CLAUDE_PROJECT_DIR || null;

const dirs = resolveDir(all, baseDir);

if (cmd === 'list') cmdList(dirs, args[0]);
else if (cmd === 'search') cmdSearch(dirs, args[0], args[1]);
else if (cmd === 'show') cmdShow(dirs, args[0], args[1] || 2000);
else if (cmd === 'outline') cmdShow(dirs, args[0], args[1] || 200, { onlyUser: true });
else if (cmd === 'index') cmdIndex(dirs, args[0]);
else if (cmd === 'match') cmdMatch(dirs, args[0], args[1]);
else if (cmd === 'hook') cmdHook(dirs);
else
  fail(
    'usage:\n' +
      '  recall.mjs list [n] [--all]\n' +
      '  recall.mjs search "<kw>" [max] [--all]\n' +
      '  recall.mjs outline <session-id-prefix> [chars-per-turn]   # questions only, start here\n' +
      '  recall.mjs show <session-id-prefix> [chars-per-turn]      # full conversation\n' +
      '  recall.mjs index [n] [--dir <path>] [--quiet]             # titles+dates only, for hooks' +
      '\n  recall.mjs match "<text>" [max]                        # sessions whose topics overlap <text>'
  );
