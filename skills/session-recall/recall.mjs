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

// Text the harness puts in the user's mouth: slash-command plumbing, task notifications, IDE
// state, injected reminders. It is addressed to the model, not typed by anyone, and it is not
// what a session was about -- `ide_opened_file` reaching the top-20 corpus terms is what happens
// when it is indexed as if it were. Anchored at the start, so a turn that merely quotes one of
// these tags in prose is still the user talking.
const ENVELOPE_TAGS =
  'command-name|command-message|command-args|local-command-[a-z]+|task-notification|' +
  'system-reminder|ide_opened_file|ide_selection';
const ENVELOPE = new RegExp(
  '<(' + ENVELOPE_TAGS + ')>[^]*?</\\1>|<(?:' + ENVELOPE_TAGS + ')>',
  'g'
);
const CAVEAT = /^Caveat: The messages below.*/;

// Envelopes are STRIPPED, not used to drop the turn: the IDE prepends <ide_opened_file> to what
// the user actually typed, so discarding the turn discards the question with it. 18dad7ee -- a
// 17-turn debugging session and an eval target -- stores nothing at all under a drop-the-turn rule.
const unwrap = (t) => t.replace(ENVELOPE, ' ').replace(CAVEAT, ' ').replace(/\s+/g, ' ').trim();

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
    // message.content is a plain string on some turns and an array of blocks on others. Reading
    // arrays only silently dropped every string-shaped turn -- and in this corpus 45 of those 46
    // turns are machine envelopes, so the array-only read was accidentally acting as a filter.
    // Both shapes are read now, and the filtering is done deliberately below instead.
    const content = o.message?.content;
    let text;
    if (typeof content === 'string') {
      text = content.replace(/\s+/g, ' ').trim();
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      continue;
    }
    if (o.type === 'user') text = unwrap(text);
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

// A short session repeats nothing, so a >=2 rule stores nothing for it and leaves it hanging on
// its auto-generated title alone. Under 4 turns there is not enough text for a repeat to mean
// anything anyway, so one mention is the best evidence available and is taken as the topic.
const SHORT_TURNS = 4;

function keywordsFor(turns, n = 6) {
  // Counted over the turns keywordsFor actually reads -- the user's own, minus interrupt markers
  // and our own pointer text. A transcript's raw length includes assistant prose and interrupts,
  // which is not what "short" means here.
  const asked = turns.filter((t) => t.role === 'user' && !INTERRUPT.test(t.text) && !isOurs(t)).length;
  const minCount = asked < SHORT_TURNS ? 1 : 2;
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
    .filter(([, c]) => c >= minCount)
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
// v5: the aliases field is gone with the model call that filled it. Entries are otherwise
// unchanged, but a stale v4 entry still carries a dead `aliases` key, so every entry is
// rebuilt once. One ~0.8s reparse across the corpus.
const CACHE_V = 7; // bump to invalidate every cached entry after a shape change

// Sessions that store no topics at all, measured 2026-08-19 on 59 sessions after 4c-b + 5-c.
// Zero is not an aspiration, it is the observed floor: every session in the corpus stores
// something. Doctor FAILS if it rises, because the only ways it can rise are a parser that
// stopped reading a transcript shape or a keyword rule that got stricter -- both silent, and
// both survivable by a green eval. Raise this ONLY with a measured reason written beside it.
const EMPTY_BASELINE = 0;

// How many stored topics per session. This one number is the whole representation: too few and
// a session is unreachable by anything but its headline words, too many and every session
// shares vocabulary with every other. Tuned by `eval`, not by taste.
const TOPICS_N = 14;

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
      topics: keywordsFor(s.turns, TOPICS_N),
      // Counted, not silently discarded: if this total ever jumps, the transcript schema
      // changed and hook output is landing in real turns. Surfaced by `recall.mjs banners`.
      banner: s.turns.filter(isOurs).length,
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

// --- scoring: stored topics are what we match against ---------------------------------
// The representation is the topic cache: each session's title plus the frequent terms from its
// user turns. No model, no cards. This is honest about its own limit -- a paraphrase that
// shares no vocabulary with the session scores zero and no threshold reaches it. `eval` reports
// that as ZERO rather than as a near miss, which is the number worth watching.
const HIT_MIN = 2;
// Two ordinary shared words are coincidence. 6 accepts either strong evidence (one
// identifier-shaped term hitting a title: 3 identish x 2 rarity x 2 title = 12) or a broad
// overlap of several weak ones. The pre-cards bar, restored unchanged.
const SCORE_MIN = 6;
const accepted = (c) => c.hits.length >= HIT_MIN && c.score >= SCORE_MIN;

// A hook that talks too much gets uninstalled, so the pointer is capped hard.
const MAX_HITS = 3;

// Where a term was found decides what it is worth. A title is a deliberate label for the whole
// session; a stored topic is merely a frequent word from it. A term in both takes the higher
// weight rather than the sum -- otherwise one word counts twice for saying one thing.
const W_TITLE = 2;
const W_TOPIC = 1;

function indexEntry(entry) {
  const terms = new Map();
  const put = (raw, w) => {
    const t = String(raw).toLowerCase().replace(/^[./-]+|[./-]+$/g, '');
    if (t.length < 3 || t.length > 40) return;
    if (STOP.has(t) || GENERIC.has(t)) return;
    if (/^[0-9a-f-]{8,}$/i.test(t)) return; // uuids, hashes, session ids
    terms.set(t, Math.max(terms.get(t) || 0, w));
  };
  for (const t of entry.topics || []) put(t, W_TOPIC);
  for (const w of (entry.title || '').toLowerCase().split(/[^a-z0-9_.-]+/)) put(w, W_TITLE);
  return terms;
}

// Rarity: "playwright" (2 sessions) is strong evidence, "skill" (7) is weak, and a flat weight
// cannot tell them apart. df is counted over EVERY indexed term -- title words included, in
// indexEntry's own key space -- so a term is weighed on the same scale it was indexed on.
//
// The pre-cards build counted topics only, on the reasoning that a title is one label rather
// than corpus evidence. That left title terms double-weighted by W_TITLE *and* sitting at df=0,
// which applyRarity reads as maximally rare and doubles again: roughly 4x, none of it earned.
// The inflation was near-uniform, so it decided ties rather than moving real targets across the
// line -- which is exactly how a session with a borrowed title outranked the work itself.
function buildMatcher(dirs) {
  const { store } = buildCache(dirs);
  const index = {};
  const df = new Map();
  for (const [key, entry] of Object.entries(store)) {
    const terms = indexEntry(entry);
    index[key.replace(/\.jsonl$/, '')] = { e: entry, terms };
    // Counting title terms here retired the precision floor 7b defended: "write a commit message
    // for these changes" had been matching 49269330 at exactly SCORE_MIN, on two title terms
    // holding a rarity bonus they had not earned. They lose it here and the match goes silent.
    for (const t of terms.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  return { store, index, df, size: Object.keys(index).length };
}

// A pasted pointer is our own wording, not the user's. Scoring on it re-matches the very
// session we already pointed at.
function promptTerms(text) {
  const cleanText = String(text)
    .split('\n')
    .filter((l) => !l.includes(BANNER_MARK) && !OURS_LINE.test(l))
    .join('\n');
  return queryTerms(cleanText);
}

// British and American spellings that genuinely differ in developer prose. A variant is only
// ever added when the corpus ALREADY contains it -- we never invent vocabulary, so an unknown
// word cannot become a match by being rewritten, and the df it lands on is a real one.
// Measured on the 20-prompt silent set: converts the colour/color case at no precision cost.
const SPELLING = [[/^colour/, 'color'], [/our(s?)$/, 'or$1'], [/ise$/, 'ize'], [/isation$/, 'ization']];

function expandSpelling(q, df) {
  for (const [term, w] of [...q]) {
    for (const [re, to] of SPELLING) {
      const alt = term.replace(re, to);
      if (alt !== term && df.has(alt) && !q.has(alt)) q.set(alt, w);
    }
  }
  return q;
}

function applyRarity(df, q) {
  const rarity = (t) => {
    const d = df.get(t) || 0;
    return d <= 2 ? 2 : d <= 5 ? 1.5 : 1;
  };
  for (const [term, w] of q) q.set(term, w * rarity(term));
  return q;
}

// Every candidate, sorted, threshold NOT applied -- the evaluator needs to see near misses.
// Tie-break toward the longer session: where two match equally well, the one that ran 400 turns
// is where the work happened, not the one that ran 1.
function candidates(m, q, self) {
  const selfId = self ? String(self).replace(/\.jsonl$/, '') : null;
  const out = [];
  for (const [id, entry] of Object.entries(m.index)) {
    if (selfId && id === selfId) continue;
    let score = 0;
    const hits = [];
    for (const [term, w] of q) {
      const cw = entry.terms.get(term);
      if (!cw) continue;
      score += w * cw;
      hits.push(term);
    }
    if (score > 0) out.push({ key: id, s: entry.e, score, hits });
  }
  out.sort((a, b) => b.score - a.score || b.s.turns - a.s.turns);
  return out;
}

function scoreText(m, text, self) {
  const q = promptTerms(text);
  if (!q.size) return [];
  // Spelling variants are added BEFORE rarity, so each one is weighted by its own document
  // frequency rather than inheriting the weight of the word the user actually typed.
  return candidates(m, applyRarity(m.df, expandSpelling(q, m.df)), self);
}

function cmdMatch(dirs, text, max = MAX_HITS, { self: selfArg = null } = {}) {
  if (!text) fail('match needs text: recall.mjs match "<prompt text>" [max]');
  // The live session shares all of the current prompt's vocabulary, so it matches strongly and
  // buries real prior work. Hooks are handed the current session on stdin; env is a CLI fallback.
  const self =
    selfArg ||
    (process.env.CLAUDE_CODE_SESSION_ID ? process.env.CLAUDE_CODE_SESSION_ID + '.jsonl' : null);

  const m = buildMatcher(dirs);
  if (!m.size) return; // brand-new project: silence, not a guess from nothing
  const scored = scoreText(m, text, self).filter(accepted);
  if (!scored.length) return;

  console.log(BANNER);
  for (const { key, s, hits } of scored.slice(0, Number(max) || MAX_HITS)) {
    console.log(
      '  ' + s.date + '  ' + key.slice(0, 8) + '  ' + String(s.turns).padStart(3) +
        ' turns  ' + (s.title || '(untitled)')
    );
    console.log('      overlaps: ' + hits.slice(0, 8).join(', '));
    if (s.ask) console.log('      asked: ' + s.ask);
    // In a short session the final reply is usually incidental, not a conclusion — only
    // quote it once the conversation was long enough to have arrived somewhere.
    if (s.outcome && s.turns >= 6) console.log('      ended: ' + s.outcome);
  }
  console.log('Read one with: recall.mjs outline <id>   (then search "<term>" for detail)');
}


// --- evaluation -----------------------------------------------------------------------
// Runs the SAME code path the hook runs, with no model call, so a score is reproducible and a
// change is attributable. Before/after numbers are only comparable if they came from here.
function cmdEval(dirs, file) {
  if (!file) fail('usage: recall.mjs eval <file.json>');
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail('could not read ' + file + ': ' + e.message);
  }
  if (!Array.isArray(entries)) fail('expected a JSON array of cases');
  // Entries without a prompt are notes kept alongside the cases, not cases.
  const cases = entries.filter((c) => c && typeof c.prompt === 'string');

  const m = buildMatcher(dirs);
  const self = process.env.CLAUDE_CODE_SESSION_ID
    ? process.env.CLAUDE_CODE_SESSION_ID + '.jsonl'
    : null;
  console.log('matching against ' + m.size + ' session(s), ' + m.df.size + ' indexed terms');

  const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
  console.log(
    pad('EXPECT', 7) + pad('ACTUAL', 7) + pad('OK', 5) + pad('PROMPT', 49) +
      pad('TOP HIT', 10) + pad('SCORE', 7) + 'HITS'
  );
  console.log('-'.repeat(104));

  const near = [];
  let recallHit = 0, recallTotal = 0, recallHitReal = 0, recallTotalReal = 0;
  // The bar was set on the cases that existed when it was set. A case added later cannot move
  // it, whether it passes or fails, so the original set is counted separately and reported first.
  let origHit = 0, origTotal = 0;
  // Lenient counts a pass when the target appears anywhere in the shown hits; strict requires
  // it to RANK FIRST. The difference is not cosmetic: a lenient pass can depend entirely on
  // MAX_HITS, so a display setting would decide the score. Strict is the honest number.
  let origHitStrict = 0;
  // The easy set: prompts built from each target session's OWN words. Counted apart from the
  // paraphrase cases because they measure a different thing -- not whether the scorer is clever,
  // but whether the session was stored richly enough to be reachable at all.
  let easyHit = 0, easyHitStrict = 0, easyTotal = 0;
  let silentOk = 0, silentTotal = 0, silentOkNoSelf = 0;

  for (const c of cases) {
    const cands = scoreText(m, c.prompt, self);
    const shown = cands.filter(accepted);
    const actual = shown.length ? 'match' : 'silent';
    const top = shown[0] || cands[0] || null;
    const wantIds = c.accept || (c.session ? [c.session] : []);

    let ok;
    if (c.expect === 'silent') {
      silentTotal++;
      ok = actual === 'silent';
      if (ok) silentOk++;
      // A prompt lifted from session X often matches X: X's card summarises the very
      // conversation that prompt was part of. Live, the current session is excluded, so that
      // hit could never fire. Counted separately rather than quietly forgiven.
      if (ok || (c.from && shown[0] && shown[0].key.startsWith(c.from))) silentOkNoSelf++;
    } else {
      recallTotal++;
      if (!c.broken) recallTotalReal++;
      if (c.original && !c.broken) origTotal++;
      if (c.easy && !c.broken) easyTotal++;
      ok = shown.some((h) => wantIds.some((w) => h.key.startsWith(w)));
      const lead = shown[0] && wantIds.some((w) => shown[0].key.startsWith(w));
      if (ok) {
        recallHit++;
        if (!c.broken) recallHitReal++;
        if (c.easy && !c.broken) {
          easyHit++;
          if (lead) easyHitStrict++;
        }
        if (c.original && !c.broken) {
          origHit++;
          if (lead) origHitStrict++;
        }
        if (!lead) {
          near.push({
            prompt: c.prompt,
            want: wantIds.join('|'),
            weak: shown[0].key.slice(0, 8) + ' (' + shown[0].score.toFixed(1) + ') leads instead',
          });
        }
      } else {
        // Did the right session score at all but fall short? That is a threshold problem.
        // Scoring zero is a vocabulary problem, and no threshold reaches it.
        const rank = cands.findIndex((h) => wantIds.some((w) => h.key.startsWith(w)));
        near.push({
          prompt: c.prompt,
          want: wantIds.join('|'),
          rank: rank < 0 ? null : rank + 1,
          cand: rank < 0 ? null : cands[rank],
          broken: !!c.broken,
        });
      }
    }

    console.log(
      pad(c.expect, 7) + pad(actual, 7) + pad(ok ? 'ok' : 'FAIL', 5) +
        pad(c.prompt, 49) + pad(top ? top.key.slice(0, 8) : '-', 10) +
        pad(top ? top.score.toFixed(1) : '-', 7) +
        (top ? top.hits.slice(0, 4).join(',') : '')
    );
  }

  console.log('-'.repeat(104));
  console.log(
    'RECALL, THE BAR   ' + origHitStrict + '/' + origTotal +
      '   original valid cases, target ranked FIRST (the bar is 3/' + origTotal + ')'
  );
  console.log(
    '  lenient         ' + origHit + '/' + origTotal +
      '   same cases, target anywhere in the shown hits'
  );
  console.log(
    'EASY SET          ' + easyHitStrict + '/' + easyTotal +
      '   target session own words, ranked FIRST'
  );
  console.log(
    '  lenient         ' + easyHit + '/' + easyTotal +
      '   same cases, target anywhere in the shown hits'
  );
  console.log(
    'recall, all valid ' + recallHitReal + '/' + recallTotalReal +
      '   including cases added after the bar was set'
  );
  console.log(
    'recall, raw       ' + recallHit + '/' + recallTotal + '   including cases marked broken'
  );
  console.log(
    'precision         ' + silentOk + '/' + silentTotal + ' stayed silent' +
      (silentOkNoSelf !== silentOk
        ? '   (' + silentOkNoSelf + '/' + silentTotal + ' ignoring hits on each case own source session)'
        : '')
  );
  console.log('threshold hits >= ' + HIT_MIN + ' AND score >= ' + SCORE_MIN);

  if (near.length) {
    console.log('\nmisses, and whether tuning could reach them:');
    for (const n of near) {
      if (n.weak) {
        console.log('  "' + n.prompt + '"' + '\n' + '      target ' + n.want + ' IS shown but ' + n.weak +
          ' -- lenient pass, strict fail.');
      } else if (n.rank === null) {
        console.log(
          '  ' + (n.broken ? '[broken] ' : '') + '"' + n.prompt + '"\n' +
            '      target ' + n.want + ' scored ZERO -- no shared vocabulary. ' +
            'Not reachable by any threshold.'
        );
      } else {
        console.log(
          '  "' + n.prompt + '"\n' +
            '      target ' + n.cand.key.slice(0, 8) + ' WAS found: rank ' + n.rank +
            ', score ' + n.cand.score.toFixed(1) + ', hits [' + n.cand.hits.join(',') + ']' +
            ' -- below the line. THIS is what tuning could reach.'
        );
      }
    }
  }
}

// Hook payloads arrive as JSON on stdin. Read it ONLY when the caller says so: a bare
// readFileSync(0) blocks until EOF when stdin is an idle terminal or an inherited pipe, which
// would hang a manual CLI run.
//
// This function was silently deleted once by a wholesale block replacement, which broke BOTH
// hooks: SessionStart crashed with a ReferenceError, and UserPromptSubmit swallowed the same
// error in its own catch and printed nothing for two hours. `recall.mjs doctor` exists because
// of that: silence is indistinguishable from a crash unless something checks.
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

// --- doctor ---------------------------------------------------------------------------
// v0.7.0 shipped with BOTH hooks dead and looked completely normal for three sessions: a
// wholesale block replacement deleted stdinPayload, SessionStart died with a ReferenceError,
// and UserPromptSubmit swallowed the identical error in its own catch and printed nothing.
// A recall failure must never block a prompt — that stays — so silence and death are
// indistinguishable unless something checks. This is the something.
//
// It runs the REAL hook commands as child processes with synthetic stdin, exactly as Claude
// Code invokes them, and fails loudly. Never wire it to a hook; run it by hand after touching
// this file. This is the only reason child_process is imported.
function cmdDoctor(dirs, projectDir) {
  const script = process.argv[1];
  const proj = projectDir || process.cwd();
  let bad = 0;
  const ok = (label, good, detail) => {
    console.log((good ? '  ok   ' : '  FAIL ') + label + (detail ? '  -- ' + detail : ''));
    if (!good) bad++;
  };

  console.log('node ' + process.version + ', script ' + script);
  console.log('transcripts: ' + dirs.join(', '));

  const transcripts = sessions(dirs);
  ok('transcripts readable', transcripts.length > 0, transcripts.length + ' file(s)');
  if (!transcripts.length) {
    console.log(bad + ' problem(s)');
    return;
  }

  // No stored topics means permanent silence, which is valid for a fresh project and broken
  // everywhere else -- so it is reported, not assumed.
  const m = buildMatcher(dirs);
  ok('topic cache built', m.size > 0, m.size + ' session(s), ' + m.df.size + ' indexed terms');

  // The 5-b regression, made visible. A parser change that dropped IDE-prefixed turns emptied
  // 18dad7ee -- 17 turns, an eval target -- of every topic, and the eval still came back green
  // because the session's title carried its cases on its own. Nothing in the harness noticed;
  // a human did. A session storing nothing is not a scoring question, so it cannot be left to
  // the scoring harness: it is checked here, against a recorded floor.
  const empty = Object.values(m.index).filter((x) => !(x.e.topics || []).length).length;
  ok(
    'sessions storing topics',
    empty <= EMPTY_BASELINE,
    empty + ' of ' + m.size + ' store nothing (baseline ' + EMPTY_BASELINE + ')' +
      (empty > EMPTY_BASELINE ? ' -- REGRESSION: something stopped reading transcript text' : '')
  );

  const payload = JSON.stringify({
    session_id: path.basename(transcripts[0]).replace(/\.jsonl$/, ''),
    transcript_path: transcripts[0],
    prompt: 'probe',
  });

  const run = (args, stdin, env) => {
    try {
      return {
        out: cpExecFile(process.execPath, [script, ...args], {
          input: stdin,
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 1 << 20,
          env: { ...process.env, ...(env || {}) },
        }),
        err: null,
      };
    } catch (e) {
      return { out: e.stdout || '', err: (e.stderr || e.message || '').split('\n')[0] };
    }
  };

  // SessionStart: must print an index and exit 0.
  const idx = run(['index', '3', '--dir', proj, '--stdin', '--quiet'], payload);
  ok(
    'SessionStart hook',
    !idx.err && /Saved Claude Code sessions/.test(idx.out),
    idx.err || (idx.out.split('\n')[0] || '(no output)').slice(0, 60)
  );

  // UserPromptSubmit: build the probe from the corpus's own most common stored topics, so a
  // healthy system MUST produce a pointer. A hand-picked probe could go stale; this one cannot.
  const common = [...m.df.entries()]
    .filter(([t]) => t.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
  const probe = run(
    ['hook', '--dir', proj, '--quiet'],
    JSON.stringify({ ...JSON.parse(payload), prompt: 'tell me about ' + common.join(' ') })
  );
  ok(
    'UserPromptSubmit hook',
    !probe.err && probe.out.includes(BANNER_MARK),
    probe.err ||
      (probe.out
        ? 'pointer printed'
        : 'NO OUTPUT for a prompt built from the corpus own most common terms')
  );
  if (probe.err || !probe.out) console.log('       probe was: "tell me about ' + common.join(' ') + '"');

  // Silence must still work: a prompt with no shared vocabulary must print nothing.
  const quiet = run(
    ['hook', '--dir', proj, '--quiet'],
    JSON.stringify({ ...JSON.parse(payload), prompt: 'what time is it in Tokyo right now' })
  );
  ok(
    'stays silent when it should',
    !quiet.err && !quiet.out.trim(),
    quiet.err || (quiet.out.trim() ? 'FIRED on an unrelated prompt' : 'silent')
  );

  console.log(bad ? bad + ' problem(s)' : 'all checks passed');
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
const args = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--all') all = true;
  else if (a === '--quiet') QUIET = true;
  else if (a === '--stdin') useStdin = true;
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
if (HOOK_ONLY) QUIET = true;
const dirs = HOOK_ONLY ? null : resolveDir(all, baseDir);

if (HOOK_ONLY) {
  try {
    cmdHook({ all, baseDir });
  } catch {
    /* a recall failure must never break a prompt */
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
else if (cmd === 'banners') cmdBanners(dirs);
else if (cmd === 'eval') cmdEval(dirs, args[0]);
else if (cmd === 'doctor') cmdDoctor(dirs, baseDir);
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
      '\n  recall.mjs eval <file.json>                              # score the matcher against a case file' +
      '\n  recall.mjs doctor                                        # check both hooks actually run'
  );
