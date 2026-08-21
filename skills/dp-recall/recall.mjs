#!/usr/bin/env node
// recall.mjs — search past Claude Code sessions for this project.
// No external deps (no jq). Node >= 18.
//
// Verified against the real transcript schema:
//   one JSON object per line; .type in (user|assistant|ai-title|last-prompt|...)
//   .message.content is an ARRAY of blocks: {type:"text"|"thinking"|"tool_use"|"tool_result"}
// Only `text` blocks are searched or printed by default; `thinking` blocks are opt-in
// via --thinking. tool_use/tool_result are NEVER read into output — that is where file
// dumps and .env values live.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const MAX_SNIPPET = 300;
const NEIGHBOR_SNIPPET = 220;

// ---------------------------------------------------------------- fs helpers

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

// stat() once per file. The old code called statSync inside a sort comparator
// (O(n log n) syscalls) and then again per command.
const statCache = new Map();
function statOf(f) {
  let s = statCache.get(f);
  if (!s) {
    s = fs.statSync(f);
    statCache.set(f, s);
  }
  return s;
}

// Claude Code derives the folder name from cwd: ':' '\' '/' '_' '.' -> '-'
// NOTE: that mapping is lossy, so `foo_bar`, `foo.bar` and `foo-bar` share one
// folder. Nothing here can undo it — the transcripts really are interleaved.
function slugFor(dir) {
  return dir.replace(/[:\\/_.]/g, '-');
}

// Walk cwd upward so the skill works from any subdirectory (apps/api, packages/x, …),
// not just the repo root. First ancestor with a transcript folder wins.
function resolveDir(all) {
  if (!fs.existsSync(ROOT)) fail(`No transcripts dir at ${ROOT}`);
  const dirs = fs.readdirSync(ROOT).filter((d) => statOf(path.join(ROOT, d)).isDirectory());
  if (all) return dirs.map((d) => path.join(ROOT, d));

  const lower = new Map(dirs.map((d) => [d.toLowerCase(), d]));
  const tried = [];
  let cur = process.cwd();
  for (;;) {
    const want = slugFor(cur).toLowerCase();
    tried.push(want);
    const hit = lower.get(want);
    if (hit) {
      if (cur !== process.cwd()) process.stderr.write(`(using transcripts for ${cur})\n`);
      return [path.join(ROOT, hit)];
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }

  fail(
    `No session folder for this project or any parent.\n  cwd:      ${process.cwd()}\n` +
      `  tried:\n${tried.map((t) => '    ' + t).join('\n')}\n` +
      `  available:\n${dirs.map((d) => '    ' + d).join('\n')}\n` +
      `  (use --all to search every project)`
  );
}

function sessionFiles(dirs) {
  const out = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.jsonl'))) {
      out.push(path.join(d, f));
    }
  }
  return out.sort((a, b) => statOf(b).mtimeMs - statOf(a).mtimeMs);
}

// ------------------------------------------------------------------ parsing

// Parse one transcript into { title, date, turns:[{idx,role,kind,text,ts}] }.
// `date` prefers the last turn's own timestamp over file mtime — touching a file
// (rsync, backup, editor) must not silently re-date the conversation.
function parseSession(file, { thinking = false } = {}) {
  let title = null;
  const turns = [];
  let thinkingSeen = 0;
  let thinkingKept = 0;
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

    const take = (kind) =>
      content
        .filter((b) => b?.type === kind)
        .map((b) =>
          typeof b.text === 'string' ? b.text : typeof b.thinking === 'string' ? b.thinking : ''
        )
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (thinking) {
      thinkingSeen += content.filter((b) => b?.type === 'thinking').length;
      const th = take('thinking');
      if (th) {
        thinkingKept++;
        turns.push({ idx: turns.length, role: o.type, kind: 'thinking', text: th, ts: o.timestamp });
      }
    }
    const text = take('text');
    if (text) turns.push({ idx: turns.length, role: o.type, kind: 'text', text, ts: o.timestamp });
  }
  const lastTs = [...turns].reverse().find((t) => t.ts)?.ts;
  const date = lastTs ? new Date(lastTs) : statOf(file).mtime;
  return { file, title, date, turns, thinkingSeen, thinkingKept };
}

// Claude Code persists `{type:"thinking", thinking:"", signature:"…"}` — the reasoning
// text is stripped before the transcript is written, only the signature survives. So
// --thinking can find nothing even when a session reasoned heavily. Say so out loud
// rather than silently returning the same results as a plain run.
function thinkingNote(seen, kept) {
  if (!seen || kept) return null;
  return (
    `# --thinking: ${seen} thinking block(s) present but empty — Claude Code strips reasoning\n` +
    `#   text before writing the transcript (only the signature is kept). Nothing to show.`
  );
}

// Cheap scan for `list --brief`: no JSON.parse per line. Parsing every line of a
// 66MB corpus just to print titles is the slowest thing this script does.
const TITLE_RE = /"aiTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const TS_RE = /"timestamp"\s*:\s*"([^"]+)"/;
function briefSession(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let title = null;
  const titles = raw.match(new RegExp(TITLE_RE, 'g'));
  if (titles?.length) {
    const m = TITLE_RE.exec(titles[titles.length - 1]);
    if (m) {
      try {
        title = JSON.parse(`"${m[1]}"`);
      } catch {
        title = m[1];
      }
    }
  }
  const stamps = raw.match(new RegExp(TS_RE, 'g'));
  const lastTs = stamps?.length ? TS_RE.exec(stamps[stamps.length - 1])?.[1] : null;
  const msgs = (raw.match(/"type"\s*:\s*"(?:user|assistant)"/g) || []).length;
  return { file, title, date: lastTs ? new Date(lastTs) : statOf(file).mtime, approxTurns: msgs, turns: null };
}

// ------------------------------------------------------------------ filters

// --since accepts 7d / 24h / 90m / 2026-08-19 ; --last is an alias.
function parseSince(v) {
  if (!v) return null;
  const rel = /^(\d+)\s*([dhm])$/i.exec(String(v).trim());
  if (rel) {
    const mult = { d: 86400e3, h: 3600e3, m: 60e3 }[rel[2].toLowerCase()];
    return new Date(Date.now() - Number(rel[1]) * mult);
  }
  const d = new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) fail(`Bad --since "${v}" — use 7d, 24h, or YYYY-MM-DD`);
  return d;
}

const fmt = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
const proj = (f) => path.basename(path.dirname(f));

// ------------------------------------------------------------------ matching

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Default stays a literal substring so existing phrase searches behave the same.
//   --or   terms split on '|' or whitespace, any one matches
//   --and  terms split on whitespace, all must appear in the same turn
//   --re   raw regex, unescaped
function buildMatcher(query, flags) {
  if (!query) fail('usage: recall.mjs search "<keyword>" [max]');
  if (flags.re) {
    let rx;
    try {
      rx = new RegExp(query, 'i');
    } catch (e) {
      fail(`Bad --re pattern: ${e.message}`);
    }
    return { test: (t) => rx.test(t), locate: (t) => t.search(rx), label: `/${query}/i` };
  }
  if (flags.or) {
    const terms = query.split(/[|\s]+/).filter(Boolean);
    const rx = new RegExp(terms.map(escapeRe).join('|'), 'i');
    return { test: (t) => rx.test(t), locate: (t) => t.search(rx), label: terms.join(' OR ') };
  }
  if (flags.and) {
    const terms = query.split(/\s+/).filter(Boolean);
    const rxs = terms.map((t) => new RegExp(escapeRe(t), 'i'));
    return {
      test: (t) => rxs.every((r) => r.test(t)),
      locate: (t) => Math.min(...rxs.map((r) => t.search(r)).filter((i) => i >= 0)),
      label: terms.join(' AND '),
    };
  }
  const rx = new RegExp(escapeRe(query), 'i');
  return { test: (t) => rx.test(t), locate: (t) => t.search(rx), label: query };
}

function snippet(text, at, width) {
  const from = Math.max(0, at - 80);
  const body = text.slice(from, from + width);
  return `${from ? '…' : ''}${body}${from + width < text.length ? '…' : ''}`;
}

// -------------------------------------------------------------------- list

function cmdList(dirs, n = 20, flags = {}) {
  const since = parseSince(flags.since || flags.last);
  const load = flags.brief ? briefSession : (f) => parseSession(f, { thinking: !!flags.thinking });

  const rows = [];
  for (const f of sessionFiles(dirs)) {
    const s = load(f);
    if (!s) continue;
    if (since && s.date < since) continue;
    rows.push(s);
    if (rows.length >= Number(n)) break;
  }
  rows.sort((a, b) => b.date - a.date);

  for (const s of rows) {
    const count = s.turns ? `${s.turns.length} turns` : `~${s.approxTurns} msgs`;
    console.log(`${fmt(s.date)}  ${proj(s.file)}  ${count}`);
    console.log(`   ${s.title || '(untitled)'}`);
    console.log(`   ${path.basename(s.file)}`);
  }
  console.log(`\n${rows.length} sessions${since ? ` since ${fmt(since)}` : ''}.`);
}

// ------------------------------------------------------------------ search

// Ranked by number of matching turns, NOT by date. Date order buries the session
// where the work happened under every later session that merely mentioned it.
function cmdSearch(dirs, query, max = 8, flags = {}) {
  const m = buildMatcher(query, flags);
  const since = parseSince(flags.since || flags.last);
  const withContext = !flags['no-context'];

  const scored = [];
  let skipped = 0;
  let thinkSeen = 0;
  let thinkKept = 0;
  for (const f of sessionFiles(dirs)) {
    const s = parseSession(f, { thinking: !!flags.thinking });
    if (!s) continue;
    thinkSeen += s.thinkingSeen;
    thinkKept += s.thinkingKept;
    if (since && s.date < since) {
      skipped++;
      continue;
    }
    const hits = s.turns.filter((t) => m.test(t.text));
    if (hits.length) scored.push({ s, f, hits, score: hits.length });
  }
  scored.sort((a, b) => b.score - a.score || b.s.date - a.s.date);

  for (const { s, f, hits, score } of scored.slice(0, Number(max))) {
    console.log(`=== ${fmt(s.date)}  ${proj(f)}  [${score} hits]  ${s.title || '(untitled)'}`);
    console.log(`    ${path.basename(f)}`);
    for (const h of hits.slice(0, 3)) {
      const tag = h.kind === 'thinking' ? `${h.role}:thinking` : h.role;
      console.log(`  #${h.idx} [${tag}] ${snippet(h.text, m.locate(h.text), MAX_SNIPPET)}`);
      // The decision usually lives in the REPLY, not in the turn that matched.
      const next = withContext ? s.turns[h.idx + 1] : null;
      if (next && next.role !== h.role) {
        const ntag = next.kind === 'thinking' ? `${next.role}:thinking` : next.role;
        console.log(`     -> #${next.idx} [${ntag}] ${snippet(next.text, 0, NEIGHBOR_SNIPPET)}`);
      }
    }
    console.log('');
  }

  if (flags.thinking) {
    const note = thinkingNote(thinkSeen, thinkKept);
    if (note) console.log(note.replace(/^# ?/gm, '') + '\n');
  }

  if (!scored.length) {
    console.log(
      `No matches for ${m.label}.${skipped ? ` (${skipped} session(s) excluded by the date filter)` : ''}`
    );
  } else {
    console.log(
      `${Math.min(scored.length, Number(max))} of ${scored.length} matching session(s), ranked by hits.\n` +
        `Jump to a hit with: recall.mjs show <id> --from <#turn>   |   reopen: claude --resume <id>`
    );
  }
}

// -------------------------------------------------------------------- show

// Print one session as conversation text. Same filter as everything else —
// tool_use / tool_result are never emitted, so this stays safe on a 15MB transcript.
function cmdShow(dirs, id, perTurn = 2000, { onlyUser = false, budget = 40000, flags = {} } = {}) {
  if (!id) fail('usage: recall.mjs show <session-id-prefix> [chars-per-turn]');
  const match = sessionFiles(dirs).filter((f) => path.basename(f).startsWith(id));
  if (!match.length) fail(`No session starting with "${id}". Run: recall.mjs list`);
  if (match.length > 1) {
    fail(`Ambiguous "${id}" — matches:\n${match.map((f) => '  ' + path.basename(f)).join('\n')}`);
  }
  const f = match[0];
  const s = parseSession(f, { thinking: !!flags.thinking });
  if (!s) fail(`Could not parse ${f}`);

  const cap = Number(perTurn);
  const turns = onlyUser ? s.turns.filter((t) => t.role === 'user' && t.kind === 'text') : s.turns;
  const total = s.turns.reduce((n, t) => n + t.text.length, 0);

  // Seek. --grep lands on the first matching turn; --from lands on a turn index
  // (the '#N' printed by search). Without these, a long session can never be read
  // past the budget cutoff.
  let from = 0;
  let seekNote = '';
  if (flags.grep) {
    const gm = buildMatcher(flags.grep, flags);
    const at = turns.findIndex((t) => gm.test(t.text));
    if (at === -1) fail(`No turn in ${path.basename(f)} matching ${gm.label}. Try 'search' across sessions.`);
    from = Math.max(0, at - 1); // one turn of lead-in
    seekNote = `# seeking to first turn matching ${gm.label} (#${turns[at].idx})`;
  } else if (flags.from !== undefined) {
    const want = Number(flags.from);
    if (!Number.isFinite(want)) fail(`Bad --from "${flags.from}" — expected a turn number`);
    const i = turns.findIndex((t) => t.idx >= want);
    from = i === -1 ? turns.length : i;
    seekNote = `# seeking to turn #${want}`;
  }

  console.log(`# ${s.title || '(untitled)'}`);
  console.log(`# ${proj(f)}  ${fmt(s.date)}  ${s.turns.length} text turns  ~${Math.round(total / 1000)}k chars`);
  console.log(`# raw file is ${(statOf(f).size / 1048576).toFixed(1)}MB — this is the text-only view`);
  if (onlyUser) console.log(`# outline: ${turns.length} user turns only (what was asked, not answered)`);
  if (flags.thinking) {
    const note = thinkingNote(s.thinkingSeen, s.thinkingKept);
    console.log(note || `# --thinking: ${s.thinkingKept} assistant reasoning block(s) included`);
  }
  if (seekNote) console.log(seekNote);
  console.log('');

  // Hard output budget. A long session at a generous per-turn cap overflows the caller's
  // tool-output limit and gets spilled to a temp file, which defeats the point.
  let spent = 0;
  let printed = 0;
  let i = from;
  for (; i < turns.length; i++) {
    const t = turns[i];
    const body = t.text.length > cap ? t.text.slice(0, cap) + `\n… [+${t.text.length - cap} chars]` : t.text;
    if (spent + body.length > budget) break;
    const tag = t.kind === 'thinking' ? `${t.role}:thinking` : t.role;
    console.log(`--- #${t.idx} [${tag}] ${t.ts || ''}`);
    console.log(body);
    console.log('');
    spent += body.length;
    printed++;
  }

  if (from > 0) console.log(`… skipped ${from} earlier turn(s) before the seek point.`);
  if (i < turns.length) {
    console.log(
      `… stopped at turn #${turns[i].idx} (${printed} shown, ${turns.length - i} left, ` +
        `${Math.round(budget / 1000)}k char budget).\n` +
        `   Continue: show ${id} --from ${turns[i].idx}\n` +
        `   Or narrow: 'outline ${id}', a smaller chars-per-turn, or --grep "<keyword>".`
    );
  }
}

// --------------------------------------------------------------------- cli

const BOOL = new Set(['all', 'or', 'and', 're', 'thinking', 'brief', 'no-context']);
const VALUE = new Set(['since', 'last', 'from', 'grep']);

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const args = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!BOOL.has(key) && !VALUE.has(key)) fail(`Unknown flag --${key}`);
    if (eq !== -1) flags[key] = a.slice(eq + 1);
    else if (BOOL.has(key)) flags[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined) fail(`--${key} needs a value`);
      flags[key] = v;
    }
  } else args.push(a);
}

const dirs = resolveDir(!!flags.all);

if (cmd === 'list') cmdList(dirs, args[0] || 20, flags);
else if (cmd === 'search') cmdSearch(dirs, args[0], args[1] || 8, flags);
else if (cmd === 'show') cmdShow(dirs, args[0], args[1] || 2000, { flags });
else if (cmd === 'outline') cmdShow(dirs, args[0], args[1] || 200, { onlyUser: true, flags });
else
  fail(
    'usage:\n' +
      '  recall.mjs list [n] [--brief] [--since 7d|YYYY-MM-DD] [--all]\n' +
      '  recall.mjs search "<kw>" [max] [--or|--and|--re] [--since 7d] [--thinking]\n' +
      '                            [--no-context] [--all]\n' +
      '  recall.mjs outline <id-prefix> [chars-per-turn]          # questions only, start here\n' +
      '  recall.mjs show <id-prefix> [chars-per-turn] [--from N] [--grep "<kw>"] [--thinking]\n' +
      '\n' +
      'flags:\n' +
      '  --or / --and / --re   multi-term: any / all / raw regex (default: literal phrase)\n' +
      '  --since 7d|24h|DATE   only sessions touched since then (alias: --last)\n' +
      '  --thinking            include assistant reasoning blocks (where rationale lives)\n' +
      '  --brief               list without full parse — fast triage on a big corpus\n' +
      '  --from N / --grep kw  seek into a long session instead of starting at turn 0\n' +
      '  --no-context          search: omit the reply that follows each hit'
  );
