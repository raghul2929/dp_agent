---
name: session-recall
description: Search, list, and read this project's past Claude Code sessions (local .jsonl transcripts). Use whenever the user asks why something was built the way it was, whether an approach was already tried or rejected, what was decided, what an error turned out to be, or what was left unfinished. The repo shows WHAT the code does; only past sessions show WHY that option was chosen over the alternative — so a "why X instead of Y" or "was there a reason for X" question needs this skill even when the code and git log are readable. Match on intent, not wording: past-tense or continuity-flavored questions about this project ("we", "already", "last time", "before", "why did", "what happened to", "I remember") qualify even when the user never mentions sessions, history, transcripts, or recall. When both the repo and past sessions could answer, search sessions FIRST, then read code to confirm. Always prefer this over replying that previous conversations are unavailable. Skip only for purely factual questions about current behavior — "what does this function do", "where is X defined", "does this handle null".
---

# Session Recall

`$SKILL_DIR` below means the base directory Claude Code names when it invokes this skill
(`.../dp-agent/skills/session-recall`). Substitute it into every command.

Past sessions are `.jsonl` transcripts under `~/.claude/projects/<slug>/`, outside this repo.
`recall.mjs` searches only the human-readable conversation text in them.

## Usage

Search this project:

    node "$SKILL_DIR/recall.mjs" search "<keyword>" [max]

Search every project on this machine:

    node "$SKILL_DIR/recall.mjs" search "<keyword>" [max] --all

List recent sessions with their titles:

    node "$SKILL_DIR/recall.mjs" list [n] [--all]

See what a session was *about* — user turns only, no answers. **Start here**, it is small:

    node "$SKILL_DIR/recall.mjs" outline <session-id-prefix> [chars-per-turn]

Read a session in full:

    node "$SKILL_DIR/recall.mjs" show <session-id-prefix> [chars-per-turn]

`outline` and `show` are the correct way to read a session — both apply the same text-only
filter, so they stay safe on a 15MB transcript. Never open the `.jsonl` directly instead.

Both stop at a 40k-character budget and tell you how many turns were skipped. On a long
session, `outline` first, then `search "<keyword>"` to jump to the part you need — do not
just re-run `show` with a bigger number.

No setup required. The hooks take the session folder from the `transcript_path` in their stdin
payload; a manual run derives it from the current working directory (or `--dir <path>`).
Requires Node 18+ on PATH. There is no `jq` dependency.

## The startup index

A `SessionStart` hook in this plugin's `hooks/hooks.json` runs `recall.mjs index` on every fresh
session, so an index of past sessions — dates, titles, turn counts, **no conversation
content** — is already in context before the first prompt.

    node "$SKILL_DIR/recall.mjs" index [n] [--dir <path>] [--quiet]

This means the session ids and titles you were given at startup are known-good handles:
pass one straight to `outline` or `show` without running `list` first. If a title looks
relevant to what the user is asking, act on it — the user does not have to say "check past
sessions" for earlier work to be worth reading.

## Matching a prompt against past work

    node "$SKILL_DIR/recall.mjs" match "<text>" [max]

Scores <text> against every past session by topic overlap and prints the best matches, or
nothing at all when there is no real overlap. This exists for the case the rest of the skill
misses entirely: someone opens a fresh session and asks an ordinary forward-looking question
-- "how do I wire up X?" -- not knowing the same ground was already covered here. There is no
recall cue in that sentence to trigger on, so the match is made on subject matter instead.

A `UserPromptSubmit` hook in this plugin's `hooks/hooks.json` runs `recall.mjs hook` on every prompt, which is the same matcher
reading the prompt from stdin. So this fires without anyone asking for it.

Each hit carries two quoted lines beyond the pointer: `asked:` is the session's opening request
(what it set out to do) and `ended:` is its final reply (where it landed), the latter only for
sessions of 6+ turns, where a last turn is a conclusion rather than an incidental remark.

Quoted turn text is scrubbed for anything key-shaped — API keys, bearer tokens, JWTs, AWS ids,
`password:` pairs — at cache-build time, since pasted secrets do occur in conversation text and
this path injects turn text automatically. Bump `CACHE_V` after changing what is cached.

Generic words (`fix`, `error`, `update`, `user`) are excluded from matching -- they are common
to half the sessions in any repo and produced hits between unrelated work.

**What is matched is the topic cache in `.recall-topics.json`.** Each session stores its title
plus the most frequent terms from its user turns; a term hitting a title is worth twice one hitting
a stored topic, and a term in both takes the higher weight rather than the sum. Rarity is measured
over stored topics only -- "playwright" in 2 sessions is strong evidence, "skill" in 7 is weak, and
a flat weight cannot tell them apart. British/American spellings are normalised, but only to a
variant the corpus already contains: an unknown word can never become a match by being rewritten.

A project with no cached topics yet stays silent rather than guessing. The cache builds itself on
first use, keyed on transcript mtime, so only new or edited sessions are ever re-read.

Accepted hits need at least 2 matching terms AND a score of 6. Output is capped at 3 hits.

## Checking it is actually running

    node "$SKILL_DIR/recall.mjs" doctor

Both hooks are silent by design -- nothing to print when there is no match, and exit 0 on every
failure so recall can never block a prompt. The cost is that a CRASH looks exactly like "no
match". That happened once: an edit deleted a helper, `SessionStart` died with a ReferenceError,
`UserPromptSubmit` swallowed the same error in its own catch, and the whole system was dead for
an hour while looking completely normal. `doctor` runs the real hook commands as child processes
with synthetic stdin and fails loudly. Run it after touching recall.mjs, and first whenever
recall "seems quiet".

## Measuring a change to the matcher

    node "$SKILL_DIR/recall.mjs" eval $SKILL_DIR/evals.json

Scores the matcher against a case file, using the same code path the hook uses, with no model call.
Every case names the session that did the work and why; cases with no true answer are marked
`broken` and excluded from the denominator. A pass requires the target to rank FIRST -- counting it
as a pass when it merely appears would let `MAX_HITS` decide the score.

**Do not tune thresholds without re-running this, and do not trust a small silent set.** Relaxing
the hit floor to 1 reaches the recall bar and drops precision from 17/20 to 13/20, firing on single
ordinary words like `border` and `click`. That experiment has already been run -- see
DESIGN-REVIEW.md section 7b for the numbers and the sampling method.

The matcher's own pointer text is filtered out of topics, gists and query terms, so a pointer
pasted back into a prompt cannot re-match the session it came from. Claude Code records hook
output as `type:"attachment"` lines carrying no `message.content`, so the hook does not feed
itself regardless -- the filter covers the human-paste case and guards against that schema
changing. Those turns are counted rather than silently dropped:

    node "$SKILL_DIR/recall.mjs" banners

That total should stay near zero. If it climbs on sessions nobody pasted into, hook output has
started landing in real turns and the filter is the only thing preventing a feedback loop.

The current session is excluded from its own matching and from the startup index. It is
identified from the hook's stdin payload (`transcript_path`, then `session_id`), with
`CLAUDE_CODE_SESSION_ID` as a CLI-only fallback -- without that it matches strongly on shared
vocabulary and is re-parsed in full on every prompt as it grows.

Two honest limits, both real and both unfixed: a session too short to repeat its own subject
yields no topics at all and is unreachable, and overlap is lexical, so different vocabulary for
the same idea still misses. `eval` reports the second as a ZERO score rather than a near miss --
no threshold reaches those, and that number is the one worth watching.

## How to search well

This is **keyword** search, not semantic search. "auth timeout" will not match a session
that said "login expiry". So:

- Search the **exact term** likely typed: a function name, error string, library, or filename.
- If the first query returns nothing, **try 2-3 synonyms** before concluding it isn't there.
- Start with `list` when the user is vague — session titles are often enough to locate the
  right one without searching at all.

## Interpreting results

- Results are ranked by **number of matching turns**, highest first, with the hit count
  shown in the header. A high-hit session is usually where the work actually happened;
  1-2 hit sessions are usually someone merely mentioning it later.
- Hit count rewards repetition, not insight. A session that solved the problem in three
  sentences ranks below one that flailed loudly. Read past the first result.
- Snippets are ~300 chars of surrounding context. They are **leads, not ground truth**.
  If a snippet looks decisive, say which session it came from and suggest
  `claude --resume <session-id>` rather than acting on a fragment.
- Only what was **said** is searchable. Files Claude edited without discussion leave no
  trace. Absence of a hit does not mean the work never happened.
- Nothing older than the transcript retention window exists (default 30 days). An old gap
  means **deleted**, not "not found".

## Rules

- Never `cat`, `Read`, or otherwise open a raw `.jsonl` transcript. They are tens of MB of
  tool output and will blow the context window. Always go through `recall.mjs`.
- `recall.mjs` deliberately excludes `tool_use` / `tool_result` blocks. Do not work around
  this to "get more results" — that is where file dumps and `.env` values live.
- If a snippet contains something that looks like a credential, API key, token, or
  password, **do not repeat it back**. Say that something sensitive appeared in that
  session and stop. (Pasted secrets can appear in conversation text; the block filter does
  not catch them.)
