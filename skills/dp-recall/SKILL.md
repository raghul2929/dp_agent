---
name: dp-recall
description: Search, list, and read this project's past Claude Code sessions — local .jsonl transcripts of every earlier conversation. Search FIRST, before anything else, on every request touching this project: code, tests, docs, plans, questions, or a vague half-sentence. Do not judge whether history seems relevant, do not wait for the request to sound like it is about the past, and do not open the repo first. The repo shows only what exists now — never what was tried, decided, rejected, broken before, or already explained to you. Whoever is asking has forgotten the earlier conversation, so nothing in their wording will point you here; no hint is not evidence of no history. Searching costs seconds, and finding nothing is a perfectly good outcome. Then read the code to check whether what the history says is still true.
---

# Session Recall

Past sessions are `.jsonl` transcripts under `~/.claude/projects/<slug>/`, outside this repo.
`recall.mjs` searches only the human-readable conversation text in them.

## When to reach for this

Don't wait to be asked about the past. The question to ask is whether the conversation you
need already happened: has this been decided, hit, tried, or stated before?

The trap worth naming: when someone asks **why** something is the way it is, the repo will
happily yield a plausible-sounding answer. Code records what was built, never the reasoning
behind it — so a rationale reconstructed from source reads as confident and can still be
wrong about the actual decision. Search first, then answer.

Same when work is about to start on an area ("I'm about to add X", "catch me up"): earlier
sessions may have already tried or rejected the approach being proposed.

Treat what you find as evidence about a past moment. It tells you what was decided and
why; the repo tells you what the code is now.

## Usage

Search this project:

    node "${CLAUDE_PLUGIN_ROOT}/skills/dp-recall/recall.mjs" search "<keyword>" [max]

Search every project on this machine:

    node "${CLAUDE_PLUGIN_ROOT}/skills/dp-recall/recall.mjs" search "<keyword>" [max] --all

List recent sessions with their titles:

    node "${CLAUDE_PLUGIN_ROOT}/skills/dp-recall/recall.mjs" list [n] [--all]

See what a session was *about* — user turns only, no answers. **Start here**, it is small:

    node "${CLAUDE_PLUGIN_ROOT}/skills/dp-recall/recall.mjs" outline <session-id-prefix> [chars-per-turn]

Read a session in full:

    node "${CLAUDE_PLUGIN_ROOT}/skills/dp-recall/recall.mjs" show <session-id-prefix> [chars-per-turn]

`outline` and `show` are the correct way to read a session — both apply the same text-only
filter, so they stay safe on a 15MB transcript. Never open the `.jsonl` directly instead.

Both stop at a 40k-character budget and tell you how many turns were skipped. **The budget is
not the end of the session** — every turn is numbered, and `show` can start anywhere:

    ... --from 94              # resume exactly where the budget cut off (search prints these #s)
    ... --grep "<keyword>"     # seek straight to the first turn mentioning it, with lead-in

So on a long session: `outline` for shape, then `--grep` to land on the part you need, then
`--from` to page forward. Never re-run `show` with a bigger per-turn number to see more.

### Narrowing

    --or / --and / --re    multi-term search: any term / all terms in one turn / raw regex
    --since 7d|24h|DATE    only sessions active since then (alias: --last)
    --no-context           search: drop the reply printed under each hit
    --brief                list: title + approximate size only, no full parse
    --all                  every project on this machine, not just this one

Default search is a **literal phrase** — `search "date range"` matches that exact string.
For synonyms, one `--or` pass beats three separate searches: `search "deeplink|redirect" --or`.

No setup required — the session folder is derived from the working directory, walking up
parent directories, so this works from `apps/api` as well as the repo root. Requires Node 18+.
There is no `jq` dependency.

## How to search well

This is **keyword** search, not semantic search. "auth timeout" will not match a session
that said "login expiry". So:

- Search the **exact term** likely typed: a function name, error string, library, or filename.
- Put the synonyms in **one** `--or` pass rather than running three searches:
  `search "auth timeout|login expiry|session expired" --or`. Only conclude it isn't there
  after that pass comes back empty.
- Use `--and` when one term is too noisy on its own — `search "deeplink lovable" --and`
  finds turns discussing both, which a literal phrase search would miss entirely.
- Reach for `--re` for shaped identifiers: ticket keys, error codes, `ZAAP-[0-9]{3}`.
- Start with `list --brief` when the user is vague — session titles are often enough to
  locate the right one without searching at all. Add `--since 7d` to answer "what did we
  just decide", which hit-ranking alone will not surface.

## Interpreting results

- Results are ranked by **number of matching turns**, highest first, with the hit count
  shown in the header. A high-hit session is usually where the work actually happened;
  1-2 hit sessions are usually someone merely mentioning it later.
- Hit count rewards repetition, not insight. A session that solved the problem in three
  sentences ranks below one that flailed loudly. Read past the first result.
- Snippets are ~300 chars of surrounding context, and each hit is followed by the **reply**
  that came after it — the answer usually holds the decision, the matched turn only holds
  the question. They are **leads, not ground truth**: if a snippet looks decisive, say which
  session it came from and suggest `claude --resume <session-id>` rather than acting on a
  fragment. Better, use the `#N` on the hit to read it in place: `show <id> --from N`.
- Only what was **said** is searchable. Files Claude edited without discussion leave no
  trace. Absence of a hit does not mean the work never happened.
- Assistant **reasoning is not recoverable**. Transcripts do store `thinking` blocks, but
  Claude Code strips the text before writing (only a signature survives), so `--thinking`
  will tell you the blocks are empty. Rationale is only findable where it was said out loud.
- Session dates come from the **last turn's timestamp**, not file mtime, so a transcript
  that was copied or touched later still reports when the conversation actually happened.
- Nothing older than the transcript retention window exists (default 30 days). An old gap
  means **deleted**, not "not found".

## What to take from a session

The point of reading a past session is to start warm, not to re-derive what was already
worked out. Pull these out explicitly and say them back before starting work:

- **Paths already located** — files and line numbers the earlier session found. This is the
  biggest saving: it replaces globbing and grepping the repo from scratch.
- **Conventions established** — where things live, what pattern new code follows, what the
  project does differently from the obvious default.
- **Decisions and their reasons** — what was chosen, and why. The code cannot tell you this.
- **Approaches tried and rejected** — the most expensive thing to rediscover, and the only
  place it is written down.
- **Threads left open** — what was unfinished, deferred, or known-broken.

Skip narration, step-by-step tool output, and generated documents. You want the conclusions,
not the transcript of how they were reached.

Then open only the files the history named. Do not re-glob the repo for something a past
session already located.

**Verify before relying.** Every path, line number, and code claim from a transcript is a
snapshot of that day; files move and code changes. Confirm a path still exists and the code
still says what the session says before building on it. History tells you where to look and
what was decided — the repo is what is true now. If they disagree, the repo wins and the
disagreement is worth mentioning.

## Rules

- Never `cat`, `Read`, or otherwise open a raw `.jsonl` transcript. They are tens of MB of
  tool output and will blow the context window. Always go through `recall.mjs`.
- `recall.mjs` deliberately excludes `tool_use` / `tool_result` blocks. Do not work around
  this to "get more results" — that is where file dumps and `.env` values live. `--thinking`
  is the only widening flag, and it only ever reaches `thinking` blocks.
- If a snippet contains something that looks like a credential, API key, token, or
  password, **do not repeat it back**. Say that something sensitive appeared in that
  session and stop. (Pasted secrets can appear in conversation text; the block filter does
  not catch them.)
