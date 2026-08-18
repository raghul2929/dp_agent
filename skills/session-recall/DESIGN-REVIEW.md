# session-recall — design review packet

Paste this whole file into a fresh Claude session and ask: *"Review this design. Is this the right
approach, or is there a better one? Where will it break?"*

---

## 1. Problem statement

Claude Code stores every past session as a `.jsonl` transcript under `~/.claude/projects/<slug>/`,
where `<slug>` is the project's absolute path with `: \ / _ .` replaced by `-`. These files are
local, per-machine, per-developer, and never in git.

Three failures follow from that:

1. **The knowledge is invisible.** A developer opens a new session and asks an ordinary
   forward-looking question — *"how should I implement the deeplink route?"* — with no idea the same
   ground was covered weeks ago. Nothing in their sentence signals recall, so nothing triggers.
2. **Skill descriptions only match phrasing.** A Claude Code skill is selected by semantic match
   against its `description`. That works when someone says *"what did we decide about X"*. It cannot
   work when the person does not know there is anything to recall.
3. **Handover loses it.** Passing a laptop to another developer passes the transcripts; moving to a
   different machine does not. Research done once gets redone.

The concrete trigger: one person researched a topic to ~70%, handed the laptop over, and the next
developer started the same investigation from zero.

**Goal:** surface relevant past work automatically, with no special phrasing, no explicit skill
invocation, and no awareness on the user's part that prior work exists.

**Non-goal:** replacing written documentation. Anything that *must* be handed over belongs in the
repo.

---

## 2. What was built

Three layers. None of them depends on model judgement, and nothing calls a model.

| Layer | Trigger | Enforced by | Output |
| --- | --- | --- | --- |
| Startup index | session start | `SessionStart` hook | ~12 session titles + topic terms |
| Prompt matcher | every prompt | `UserPromptSubmit` hook | 0–3 pointers, or nothing |
| The skill | Claude decides | `description` matching | `outline` / `search` / `show` |

**Two hooks.** There was briefly a third: a `SessionEnd` hook running `recall.mjs digest`, which
made one `claude -p --model haiku` call per session and wrote a summary card to
`~/.claude/recall/<project>/`. That layer was removed in v0.8.0 — see section 7c for what it
bought, what it cost, and why it should not be rebuilt. Everything is matched against
`.recall-topics.json`, keyed on transcript mtime, built with no model and no network.

**Distribution note — the local-copy detour.** This packet describes the skill as shipped via
`${CLAUDE_PLUGIN_ROOT}` in the dp-agent plugin, and that is still where it lives. But the work
recorded in sections 7 onward was carried out against a **local copy** in a single project
(`zaap-app/.claude/skills/session-recall/`, wired through `.claude/settings.local.json` with
`${CLAUDE_PROJECT_DIR}` paths), because iterating on a plugin means reinstalling it to see each
change. The local copy and the plugin drifted: the plugin sat at `CACHE_V = 2` with no alias
layer while the local copy gained aliases, banner filtering, self-exclusion, transcript-path
resolution and summary cards. As of v0.8.0 the two are byte-identical apart from line endings. They were reconciled by merging back into the plugin, and the
local copy must be removed at the moment the plugin is enabled for a project — not after — or
both sets of hooks fire and every prompt gets two pointers.

Layers 1 and 2 are deterministic — the harness runs them regardless of what the model thinks.

### Files

```
skills/session-recall/
    SKILL.md        118 lines   description + usage, read by Claude when the skill is invoked
    recall.mjs      594 lines   the whole implementation, zero dependencies, Node 18+
hooks/hooks.json                two hook entries (SessionStart, UserPromptSubmit)
```

Generated at runtime, not shipped:

```
~/.claude/projects/<slug>/.recall-topics.json    keyword cache, keyed on file mtime + CACHE_V
```

Distributed as part of the `dp-agent` Claude Code plugin (v0.5.0), so hooks resolve via
`${CLAUDE_PLUGIN_ROOT}` and nothing is copied by hand or written into the project.

---

## 3. Flow

### A · Session start

```
You            Claude Code           recall.mjs            ~/.claude/projects/<slug>/
 |  open          |                      |                            |
 |--------------->|                      |                            |
 |                | SessionStart hook    |                            |
 |                | "index 12 --quiet"   |                            |
 |                |--------------------->|                            |
 |                |                      | read 30 newest .jsonl      |
 |                |                      |--------------------------->|
 |                |                      |<-- titles, turns, text ----|
 |                |                      | keywordsFor(user turns)    |
 |                |<-- 12 lines: date, id, title, topics              |
 |                |                                                   |
 |                |==> injected into context before the first prompt   |
```

### B · Every prompt  (the part that matters)

```
You          Claude Code        recall.mjs        .recall-topics.json      Claude
 |  prompt       |                  |                     |                  |
 |-------------->|                  |                     |                  |
 |               | UserPromptSubmit |                     |                  |
 |               | prompt as JSON on stdin                |                  |
 |               |----------------->|                     |                  |
 |               |                  | <12 chars -> exit silently             |
 |               |                  |                     |                  |
 |               |                  | queryTerms():       |                  |
 |               |                  |  drop STOP + GENERIC|                  |
 |               |                  |  weight 3 if identifier-shaped         |
 |               |                  |                     |                  |
 |               |                  | buildCache():       |                  |
 |               |                  |  reuse if mtime + CACHE_V match        |
 |               |                  |-------------------->|                  |
 |               |                  |<-- topics, aliases, |                  |
 |               |                  |    title, ask, outcome                 |
 |               |                  |                     |                  |
 |               |                  | df over corpus -> rarity scaling       |
 |               |                  | title hit x2, topic x1, alias x1       |
 |               |                  |                     |                  |
 |               |                  | hits >= 2 AND score >= 6 ?             |
 |               |                  |   no  -> print nothing, exit 0         |
 |               |                  |   yes -> sort by score, then turns     |
 |               |                  |                     |                  |
 |               |<-- top 3: id, title, overlaps, asked, ended               |
 |               |--------------------------------------------------->|
 |<------------------------------------------------------ answer     |
```

### C · Reading an old session

```
ROUTE 1 (normal, nothing said)            ROUTE 2 (fallback)
pointer from B already in context         user happens to phrase it as recall
              |                                        |
              +--------------------+-------------------+
                                   v
                     Claude decides it is worth opening
                                   v
                    recall.mjs outline <id> / search "<kw>"
                                   v
                  transcripts, text blocks only, 40k budget
```

### D · Alias enrichment — REMOVED in v0.8.0

`enrich` spawned `claude -p ... --model haiku` per session to generate alias keywords. It stopped
working the moment `CACHE_V` went from 3 to 4 (rebuilt entries start with `aliases: []` and nobody
re-ran it), and it was deleted in v0.8.0 along with the cards. See section 7c.

---

## 4. Script content — what `recall.mjs` contains

| Lines | Function | Role |
| --- | --- | --- |
| 23–47 | `slugFor`, `resolveDir` | map a project path to its transcript folder |
| 57 | `parseSession` | read `.jsonl`, keep **only** text blocks — `tool_use`/`tool_result` excluded so file dumps and `.env` values never enter context |
| 105–169 | `cmdList`, `cmdSearch`, `cmdShow` | original human-facing commands (`list`, `search`, `outline`, `show`) |
| 224 | `keywordsFor` | topic extraction: user turns only, terms seen twice+, identifier-shaped terms qualify on one mention |
| 263 | `cmdIndex` | startup listing, 30-file scan window, 70-char title cap |
| 321 | `gistOf` + `redact` | opening ask + final reply, 200 chars each, secrets scrubbed |
| 364 | `buildCache` | mtime + version keyed cache |
| 421–474 | `queryTerms`, `indexEntry`, `buildMatcher` | what is indexed, and at what weight |
| 489–551 | `promptTerms`, `expandSpelling`, `applyRarity`, `candidates`, `scoreText` | scoring |
| 552 | `cmdMatch` | thresholds and the printed pointer |
| 734–785 | `stdinPayload`, `dirsFromPayload`, `selfFileFrom`, `cmdHook` | hook entry, never throws |
| 584 | `cmdEval` | reproducible scoring against `evals.json`, no model call |
| 796 | `cmdDoctor` | runs both hooks as child processes and fails loudly |

### Key constants

```
SCAN_WINDOW = 30      files parsed at session start
CACHE_V     = 5       bump invalidates every cached entry
TOPICS_N    = 14      terms stored per session  (named constant since v0.8.0)
gist cap    = 200     chars for ask / outcome
threshold   = hits >= 2 AND score >= 6
weights     = title x2,  topic x1   (a term in both takes the higher, not the sum)
rarity      = df <= 2 -> x2,  df <= 5 -> x1.5,  else x1   (df over stored topics only)
MAX_HITS    = 3       pointers printed
```

---

## 5. SKILL.md — the description that drives layer 3

```
description: Search, list, and read this project's past Claude Code sessions (local .jsonl
transcripts). Use whenever the user asks why something was built the way it was, whether an
approach was already tried or rejected, what was decided, what an error turned out to be, or
what was left unfinished. The repo shows WHAT the code does; only past sessions show WHY that
option was chosen over the alternative — so a "why X instead of Y" or "was there a reason for
X" question needs this skill even when the code and git log are readable. Match on intent, not
wording: past-tense or continuity-flavored questions about this project ("we", "already", "last
time", "before", "why did", "what happened to", "I remember") qualify even when the user never
mentions sessions, history, transcripts, or recall. When both the repo and past sessions could
answer, search sessions FIRST, then read code to confirm. Always prefer this over replying that
previous conversations are unavailable. Skip only for purely factual questions about current
behavior — "what does this function do", "where is X defined", "does this handle null".
```

The body documents the commands, the ranking caveats, and two hard rules: never open a raw
`.jsonl` directly (they reach 15 MB), and never repeat anything credential-shaped found in a
snippet.

---

## 6. Design decisions and why

| Decision | Reason |
| --- | --- |
| Hook, not description tuning | A description can only match phrasing. The target user has no recall phrasing to match. |
| Pointer, not content | Injecting transcript text into every prompt would bury the actual question. The pointer is ~4 lines; Claude decides whether to open the session. |
| Cache keyed on mtime | Parsing 92 transcripts takes ~0.8s; a prompt hook has milliseconds. Warm path is ~0.12s. |
| Model call at cache time, never per prompt | Enrichment is once per session; matching is every prompt. Put the expensive thing on the rare side. |
| `enrich` is explicit, not a hook | A ~13s model call inside a 20s `SessionStart` hook risks blowing the timeout and losing the startup listing. |
| Rarity scaling, not a blocklist | `playwright` (2 sessions) is evidence; `skill` (7 sessions) is noise. A hand-maintained stopword list does not scale. |
| Secrets scrubbed at cache build | Pointers were safe by construction; quoting turn text is not. People paste tokens into chat. |
| Exit 0 on every failure | A recall failure must never block a prompt. |
| Shipped as a plugin | `${CLAUDE_PLUGIN_ROOT}` resolves per machine, so no absolute paths and no per-project setup. |

---

## 7. Measured behaviour

Corpus: 92 sessions, one project.

**Precision — these must stay silent, and do:**

```
add a null check to the invoice parser                  silent
what does this function do                              silent
fix the ruff N818 error on guardrail exceptions         silent
```

**Recall when vocabulary overlaps — 5/5:**

```
what is a good way to structure playwright tests        -> 406-turn Playwright session
I need to build the audit catalog dashboard screen      -> 178-turn audit session
how is agent routing organised in this repo             ->  85-turn architecture session
the report generation keeps looping, how do I fix it    ->  83-turn fix session
I want to change the design system colours              -> 154-turn design session
```

**Recall when vocabulary is deliberately different — 0/5 (before aliases):**

```
how do I automate browser tests end to end here         MISS
I want to update the colour palette and typography      MISS
where do I add the compliance log screen                MISS
how are the sub-agents wired together in this repo      MISS
the pdf keeps regenerating over and over                MISS
```

**After alias enrichment (27 of 92 sessions enriched, all eligible ones): 1/5.**

Only the Playwright paraphrase started matching. Precision was unaffected — all five
must-stay-silent prompts remain silent.

Diagnosis: aliases are generated from title + topics only, so the model never sees the
conversation. Session 97cc7b22 is titled "Review design system changes and feasibility", which
yields aliases like design-review / feasibility / impact-analysis — nothing resembling colour,
palette or typography. The alias layer is limited by the thinness of its input, not by the
matching.

An initial bug is worth recording: alias hits were first scored at x1 while the accept threshold
(>= 6) had been calibrated for title hits at x2, so two alias hits could reach at most 4 and could
never fire. Aliases now carry title weight. That fix alone took the result from 0/5 to 1/5.

**Coverage limits:** 39% of sessions produce topic terms — 55 of 92 are under 4 turns and never
repeat their own subject. Those fall back to title matching only. 27 sessions have 6+ turns and are
therefore eligible for aliases at all.

---

---

## 7b. Measurement, 2026-08-19 — card-based matching

Everything in section 7 above was measured against the *word-frequency* representation and is kept
for history. This section is the current state, measured with a reproducible harness rather than by
hand:

```
node <skill>/recall.mjs eval <skill>/evals.json --dir <project>
```

No model call, no network: same code path the `UserPromptSubmit` hook runs. Any two numbers in this
section are comparable because they came from that command.

### The bar

3 of the 4 original valid paraphrase cases, with precision held. A fifth original case
(*"where do I add the compliance log screen"*) is marked `broken` and excluded from the
denominator: no session in the corpus is about a compliance log screen, the nearest real work
shares zero vocabulary with the prompt, and no lexical method can reach it. A case with no true
answer is a broken test, not a failing one. A sixth case was added later and is reported
separately — a case added after the bar was set cannot move the bar.

### Result history

| Stage | Bar (strict) | Precision | What changed |
| --- | --- | --- | --- |
| word-frequency baseline | 0/4 | 17/20 | starting point, cards not yet used |
| card-based matching | 1/4 | 17/20 | summaries + topics replace word counts |
| `SCORE_MIN` 6 -> 4 | 1/4 | 17/20 | the one threshold adjustment allowed |
| + spelling normalisation | **1/4 strict, 2/4 lenient** | **17/20 (19/20 excl. self-match)** | `colour` reaches `color-palette` |

**Strict counts a pass only when the target session RANKS FIRST.** Lenient counts it when the
target appears anywhere in the shown hits. The difference is not cosmetic: a lenient pass can
depend entirely on `MAX_HITS`, which would let a display setting decide the score. The
colour/typography case is exactly that — the right session is found and shown, but a 9-turn
states-of-matter artifact outranks a 154-turn design-system session, so it is recorded as a fail.

**The bar was not reached.** 1/4 strict, 2/4 lenient, against a bar of 3/4.

### Precision, and why it is reported twice

20 silent cases, not 5. Fifteen were taken verbatim from real transcripts: every user turn of
18-110 characters was collected (251 of them), every 4th was sampled, and selection was by
category — current-state debugging, routine edits, git operations, one-off lookups — without
running the matcher on any of them first. Prompts that would obviously match, such as *"how did we
set up Playwright in this project?"*, were excluded because they SHOULD match.

A prompt lifted from session X frequently matches X: X's card summarises the very conversation that
prompt was part of. Live, the current session is excluded from its own results, so that hit could
never fire. Precision is therefore reported both raw and ignoring hits on a case's own source
session. At the shipped setting only one false alarm is not a self-match.

### The most valuable finding: HIT_MIN = 1 reaches the bar and must not be used

Both remaining bar misses find their target and are rejected for matching on a single term
(`pdf` at 4.0; `agent` at 3.0 with plural handling). Relaxing `HIT_MIN` from 2 to 1 therefore
reaches **3/4** — and collapses precision:

| Setting | Bar | Precision (raw) | Precision (excl. self) |
| --- | --- | --- | --- |
| `HIT_MIN = 2` (shipped) | 1/4 strict, 2/4 lenient | 17/20 | 19/20 |
| `HIT_MIN = 1` + spelling | 3/4 | **13/20** | **16/20** |

Seven false alarms, fired by one ordinary word each: `border is not visble clearly` -> the design
session on [border, borders]; `check i click the flask icon` -> an e2e session on [click];
`dont mention loal pipe line flow in pr` -> an audit session on [mentions].

This was invisible against a 5-prompt silent set, where `HIT_MIN = 1` looked like a free pass.
**If you are tempted to relax the hit floor, this is the experiment that already ran.** Enlarge the
silent set before trusting any relaxation, and do not treat a 5-case precision score as evidence.

### What was tried and rejected

| Change | Effect | Kept? |
| --- | --- | --- |
| splitting query tokens into parts | zero change in every variant | no |
| plural normalisation | target reachable but still 1 hit; inflates a false alarm 5.0 -> 7.0 | no |
| spelling normalisation (British/American) | converts the palette case, precision unchanged | **yes** |
| `HIT_MIN` 2 -> 1 | 3/4 bar, precision 13/20 | no |

Spelling normalisation only ever adds a variant the corpus already contains, so an unknown word
cannot become a match by being rewritten.

### One regression this project caused, recorded deliberately

Section 7 reports 1/5 paraphrase recall using the alias layer. Bumping `CACHE_V` from 3 to 4 during
the hook-hardening work invalidated every cache entry, and rebuilt entries start with
`aliases: []` because `enrich` was never re-run. The alias layer silently vanished and the one
paraphrase that used to match stopped matching, which is why the baseline here is 0/4 rather than
1/4. It was not repaired, because cards replace that representation entirely — but a cache-version
bump silently discarding a whole layer of enrichment is worth knowing about before bumping the
next one.

### Verdict  — SUPERSEDED, see section 7c

Lexical matching over model-written cards moved paraphrase recall from unreachable to nearly
reachable: baseline misses scored ZERO, whereas the remaining misses now rank first or second and
fall short only at the threshold. It did not reach 3/4, and the single lever that does reach it
costs a quarter of the system's silence. The next step is local embeddings over the same cards.
Nothing else needs to change: cards, the digest pipeline, all three hooks, `--backfill`,
`--upgrade` and this eval harness are all representation-agnostic; only `cardCandidates` computes
similarity.

**That recommendation was not taken.** Cards were removed in v0.8.0 without ever running
as a plugin. The numbers above stand as measured; section 7c records what happened next and why.

## 7c. Cards were built, measured, and removed — do not rebuild them

**Read this before proposing summary cards again.** They were tried in full, measured with the
harness in 7b, and deleted in v0.8.0 (`e840adf`). The rollback tag `cards-v0.7.1` holds the
complete implementation if it is ever wanted back.

### What they were

One model-written `.md` per session in `~/.claude/recall/<project>/` — three sentences of prose plus
12 deliberate search terms, produced by a `claude -p --model haiku` call from a `SessionEnd` hook,
matched against instead of the topic cache.

### Why they were removed

Not because they failed on their own terms. Because of what they cost against what they bought:

- A **model call per session close**, on a hook whose entire job is to be silent and cheap.
- A **second store** outside the transcript folder, with its own backfill, upgrade and
  fallback-card paths, and its own failure mode (`source: fallback` cards that look real).
- **861 lines**, 1377 vs 516 — more than the rest of the system put together.
- They **never ran as a plugin.** The installed dp-agent was 0.4.1, which ships no session-recall
  at all; v0.5.0-v0.7.1 only ever executed as a loose copy in one project. The measured benefit was
  never actually delivered to anyone.

### Before / after, same harness, same corpus

| | cards v0.7.1 | stripped v0.8.0 |
|---|---|---|
| paraphrase, strict (target ranks first) | 1/4 | 0/4 |
| paraphrase, lenient | 2/4 | 0/4 |
| precision (silent set) | 17/20 | 19/20 |
| lines | 1377 | 963 |
| model calls | 3 | 0 |
| hooks | 3 | 2 |

Cards bought **one** paraphrase case, strict, and cost two points of precision. That is the whole
trade. Anyone proposing to rebuild them needs a better answer than "it should help".

### The easy baseline, 2026-08-19 — what actually limits recall  *(dirty corpus — superseded as a baseline by 7d)*

The paraphrase cases were the wrong first target. Before asking the scorer to bridge vocabulary
gaps, ask whether the session is stored richly enough to be found by its *own* words. 15 cases were
added (`easy: true`), each built from wording taken from the target session's transcript and
verified via `outline`, spread from 1 turn to 406:

```
EASY SET          10/15   target session own words, ranked FIRST
  lenient         12/15   target anywhere in the shown hits
precision         19/20   unchanged
```

**These numbers were measured on the pre-cleanup corpus of 100 cached sessions, 44 of which were
the recall system's own exhaust.** They are kept here because the analysis below is built on them,
but they are *not* the baseline for any later work. See 7d.

### The stored-representation distribution — the real ceiling

From `.recall-topics.json`, 99 sessions:

| stored topics | sessions | |
|---|---|---|
| 0 | 60 | 61% |
| 1-2 | 3 | 3% |
| 3-5 | 4 | 4% |
| 6-10 | 3 | 3% |
| 11-14 | 29 | 29% |

Median **0**. Mean 4.5. 28 sessions sit at the `TOPICS_N = 14` cap. The distribution is bimodal:
either a session stores nothing, or it stores the maximum. Almost nothing lands in between, because
`keywordsFor` requires a term to appear **twice**, and a short session repeats nothing.

It correlates almost perfectly with length: **90% of 1-3 turn sessions store zero topics**, versus
0% of sessions over 12 turns.

**But zero topics does not mean unreachable, and this is the finding that matters.** The session
*title* is indexed too, at double weight. Of the 60 zero-topic sessions, **54 are still reachable by
title alone** — four of the six easy cases targeting <=2-topic sessions passed on title words only.
The true dead zone is sessions that are **both untitled and topic-less: 6 of 99.**

So the ceiling is not "61% of sessions are invisible". It is:

1. **6 sessions are genuinely invisible** (untitled + no topics) — e.g. `ccda60ba`, "fix the ruff
   N818 lint error", and `91efb6b3`, "msal login keeps failing in the e2e run". Both scored ZERO on
   their own verbatim opening sentence. `ruff`, `N818` and `msal` are exactly the identifier-shaped
   terms the scorer weights highest, and not one of them is stored anywhere.
2. **54 sessions hang entirely on their auto-generated title** — a 3-to-8-word summary someone else
   wrote. Lose the title and they join group 1.
3. **Ranking, not retrieval, is the other half.** Two of the three remaining easy misses were found
   and shown but outranked by a session with a fuller topic set (`3d53c1be` lost to `5416e4f7`;
   `3d571d19` ranked 9th behind `f20f2e71`). Those are threshold and weighting problems, reachable
   by tuning.

---

## 7d. Corpus cleanup, 2026-08-19 — the baseline 4a/4b/4c are measured against

Everything in 7b and 7c was measured against a corpus that was 44% machine exhaust. Those 44
transcripts were not sessions anyone had:

| kind | n | what it was |
|---|---|---|
| `RECALL-LEDGER-SUMMARIZER-V1` runs | 37 | the archive summarizer's own invocations, saved as transcripts |
| `Reply with exactly the word: PONG` | 5 | health probes |
| empty `/cmd` stubs | 2 | 2 KB, no conversation |

Moved to `D:\work_space\_recall-trash-2026-08-19\` — deliberately **outside**
`~/.claude/projects/`, because `sessions()` reads that directory and a dot-folder inside it would
still be a candidate for re-reading. `.recall-topics.json` was deleted and rebuilt from scratch.

Human sessions were left alone, including the 15 one-shot questions that store nothing
(`ccda60ba` "fix the ruff N818 lint error", `536ac9bf` "why is the deeplink route using a path
param", `5b4c5352` "how do I get the login flow working in the tests"). Those are real questions
and exactly what recall is for; that they are unfindable is the failure being measured, not a
reason to delete the evidence.

### Before / after

| | dirty (100 cached) | clean (59 cached) |
|---|---|---|
| files on disk | 103 | 59 |
| cached sessions | 100 | 59 |
| indexed terms (df, topics only) | 282 | **282 — unchanged** |
| topics/session: 0 | 60 | 19 |
| 1-2 | 3 | 3 |
| 3-5 | 4 | 4 |
| 6-10 | 3 | 3 |
| 11-14 | 30 | 30 |
| EASY, strict | 10/15 | **11/15** |
| EASY, lenient | 12/15 | 12/15 |
| paraphrase bar, strict | 0/4 | 0/4 |
| precision | 19/20 | 19/20 |

Top-20 terms by session count are **byte-identical before and after**: `zaap-app` 11, `work_space`
10, `user` 8, `git` 7, `name` 7, `skill` 7, `session` 6, `branch` 5,
`claude/skills/session-recall/recall.mjs` 5, `recall.mjs` 5, then `claude`, `design`, `dp-agent`,
`e2e`, `every`, `flow`, `ide_opened_file`, `keyword`, `node`, `page` at 4.

### The correction: they were not flattening rarity

The stated reason for cutting them was that 37 near-duplicate sessions were diluting the df scale.
That was wrong, and the measurement says so: every one of the 44 stored **zero** topics, so not one
of them ever entered `df`. `df` is built over stored topics only — titles are deliberately excluded
(see the comment above `buildMatcher`). The rarity scale never saw them.

What they actually did is worse and narrower. `indexEntry` weights **title** terms at `W_TITLE = 2`
while `df` ignores titles entirely. A summarizer session inherits its subject's real title — "Fix
e2e test register modal hang", "Add model usage deep-link destination" — so it carried full
double-weighted title vocabulary into scoring while contributing nothing to the rarity denominator
that vocabulary is weighed against. They were not noise in the scale; they were **untaxed
competitors at the top of the ranking**, and they were winning:

- `for one cell can we place 3 different urls` → was won by `bd393c7f` (summarizer, 12.0); now
  resolves to the real session `4b5424cf` (10.0). **This is the single strict point gained.**
- `how do we pass a date range through the url` → was won by `83058b1b` (summarizer, 8.0); the real
  target `1aedc9fe` now ranks **first** at 4.0 — still under `SCORE_MIN`, but now the top hit.
  Reachable by tuning; previously not, because a summarizer sat above it.
- `msal login keeps failing in the e2e run` → was a *false* match on `05fb8cfa` (summarizer, 11.0);
  now correctly silent. The strict score does not move (it was already FAIL), but a confident wrong
  answer became an honest miss.
- `how do I get the login flow working in the tests` → same story, `05fb8cfa` displaced.

So the cleanup bought one strict point and removed three fake top-hits. The zero-topic bucket
dropping 60 → 19 is the honest measure of what was removed: 41 of the 60 "stores nothing" sessions
were never sessions at all, which means the "61% of sessions are invisible" figure in 7c was
inflated by machine noise. On the clean corpus it is **19 of 59, 32%**.

### The baseline

Any claim made by 4a, 4b or 4c is measured against **this**, on 59 sessions:

```
EASY SET          11/15   strict, target ranked FIRST
  lenient         12/15
paraphrase bar     0/4    strict and lenient
precision         19/20
indexed terms     282     over 59 sessions
```

Do not compare a post-4c number against the 10/15 in 7c. That figure belongs to a different corpus.

---

## 7e. 4d and 4c-b, 2026-08-19 — the current baseline

Two changes, measured one at a time against 7d, each kept on its own result.

| | 7d baseline | +4d | +4c-b |
|---|---|---|---|
| EASY, strict | 11/15 | 11/15 | **12/15** |
| EASY, lenient | 12/15 | 12/15 | **13/15** |
| paraphrase bar | 0/4 | 0/4 | 0/4 |
| precision | 19/20 | **20/20** | 19/19 † |
| sessions storing nothing | 19 | 19 | **0** |
| df terms (topics) | 282 | 282 | 354 |

† The silent set is 19 cases from 4c onward, not 20 — see "The retired case" below.

### 4d — title terms folded into df

`W_TITLE = 2` unchanged; `buildMatcher` now counts title terms in `df` as well as topics, via
`indexEntry`'s own key space. Before this, a title term was double-weighted *and* had `df = 0`,
which `applyRarity` scores at the maximum 2x — roughly 4x total, with no corpus evidence behind it.
That asymmetry is what let the summarizer sessions of 7d outrank real work.

It bought exactly one case, and it is the case 7b named as the precision floor:
`write a commit message for these changes` was matching `49269330` at exactly `SCORE_MIN` (6.0, on
`commit,changes` — both title terms). With titles in `df` those terms lose their rarity bonus, the
score falls to 4.0, and the match correctly goes silent. **Precision 19/20 -> 20/20; the floor 7b
defended at 4/5 is no longer a floor.**

No ranking case moved. The asymmetry inflated every session's title terms about equally, so it
decided ties — which is how a summarizer with a borrowed title beat a real session — but it was not
what put real targets over or under the line.

### 4c-b — single-mention topics for short sessions

`keywordsFor` requires a term to appear twice. A short session repeats nothing, so it stored
nothing and hung entirely on its auto-generated title (7c, group 2). Under `SHORT_TURNS = 4` the
threshold drops to one mention.

The gate counts **the turns `keywordsFor` actually reads** — user role, minus interrupt markers and
our own pointer text — not raw transcript length. The first attempt gated on `turns.length`, which
includes assistant prose and interrupts: `ccda60ba` (2 turns) qualified, but `91efb6b3` ("msal login
keeps failing in the e2e run", 2 real questions, 4 raw turns) did not and stayed empty. Both
readings scored 12/15 strict and 13/15 lenient; the user-turn gate is kept because it takes
sessions storing nothing from 19 to **0** rather than to 7.

Composition shifted underneath the same total. `msal login keeps failing in the e2e run` now
passes. `how do I get an audit catalog event by event id` dropped out — `1c216e6b` still ranks
first, but at 5.0 instead of 8.0, because `audit` and `catalog` are now stored by more sessions and
lost rarity. That is a below-threshold near-miss of the same class as the date-range case, reachable
by tuning, not a retrieval failure.

Storing more per session is not free: it raises `df` and therefore lowers the rarity multiplier for
every term it touches. The audit-catalog case is that cost showing up. Watch for it when adding to
what is stored.

### The retired case, and why it is not a precision regression

4c appeared to cost a precision point:

```
silent  match  FAIL  fix the ruff N818 error on guardrail exceptions -> ccda60ba 8.0
```

`evals.json` held two prompts one word apart with opposite expectations — this one expecting
silence, and an `easy` case ("fix the ruff N818 **lint** error on guardrail exceptions") expecting a
match on `ccda60ba`. The silent case's stated rationale was that `fix` and `error` are stoplisted;
what actually produced the silence was `ccda60ba` storing **zero topics**, so `ruff`, `N818`,
`guardrail` and `exceptions` were nowhere in the corpus. Its expectation was only ever satisfied by
the defect 4c fixes.

It was **retired, not reworded** — the session it names exists, is about exactly this, and is asked
for verbatim by its twin, so any silent case built on this prompt is unsound. A `_note` in its place
in `evals.json` records the reasoning. **The silent set is 19 cases from here. Do not compare a
post-4c precision x/19 against the x/20 figures in 7b, 7c or 7d.**

### The baseline

```
EASY SET          12/15   strict, target ranked FIRST
  lenient         13/15
paraphrase bar     0/4    strict and lenient
precision         19/19   on 19 silent cases
sessions storing nothing   0 of 59
```

Measurement noise, worth knowing: the live session's own transcript grows during a run, so its
cache entry is recomputed and the indexed-term total moves by a term or two between otherwise
identical runs. Ranking and pass counts are stable; do not read significance into +/-1 on term
counts.

---

## 7f. Step 5, 2026-08-19 — the parser, and three retractions

Kept, score-neutral, on correctness grounds. The standing rule was adjusted to allow this: *revert
what does not improve the numbers* governs **scoring** changes. A correctness fix that moves no
number still ships, because the failure it prevents is silent and no harness reports it.

### Retraction 1 — there was no data loss

`parseSession` read `message.content` only when it was an array, and 46 user turns across 16 of 59
sessions store it as a plain string. That was reported as data loss. It was not:

| what the 46 string turns actually are | n |
|---|---|
| machine envelopes — `<command-name>`, `<local-command-caveat>`, `<task-notification>` | 45 |
| the `RECALL-LEDGER-SUMMARIZER` prompt in `5ff4f298` | 1 |
| **turns a human typed** | **0** |

Not one turn of human prose was being lost. The array-only read was **accidentally acting as an
envelope filter** — doing something useful for a reason nobody chose. The bug was real; the
consequence claimed for it was not. It was also the same gap that made the first pass of the 7d
corpus audit undercount every session, which is how it was found.

Every command shares this parser — `cmdList`, `cmdSearch`, `cmdShow` (serving both `show` and
`outline`), `cmdIndex` and `buildCache` — so the omission was never scoring-only. It applied
equally to reading by hand. Given what the dropped turns contained, nothing worth reading was
hidden.

### Retraction 2 — a green eval hid a session losing everything

Three fixes were measured. All four rows score identically:

| | EASY strict | lenient | paraphrase | precision | df terms | storing nothing |
|---|---|---|---|---|---|---|
| 4c-b (7e baseline) | 12/15 | 13/15 | 0/4 | 19/19 | 354 | 0 |
| 5-a naive both-shapes | 12/15 | 13/15 | 0/4 | 19/19 | 350 | 0 |
| 5-b drop envelope turns | 12/15 | 13/15 | 0/4 | 19/19 | 342 | **2** |
| 5-c strip envelopes | 12/15 | 13/15 | 0/4 | 19/19 | 362 | 0 |

5-a feeds all 45 envelopes into topics — strictly more junk, no gain. 5-b dropped any user turn
beginning with an envelope tag, which is wrong because the IDE **prefixes** `<ide_opened_file>` to
what the user actually typed: dropping the turn drops the question with it. It emptied `18dad7ee`
— a 17-turn debugging session and an eval target — of every stored topic.

**The eval stayed green anyway.** `18dad7ee` kept passing its cases on its auto-generated title
alone, exactly the title-only fragility 7c described in group 2. A session lost 100% of its stored
representation and every number in the harness held still. That is the finding: **the eval measures
whether answers come out right, not whether the corpus is intact**, and those come apart quietly.
A human noticed. See the doctor check below, so nobody has to notice it twice.

### Retraction 3 — kept anyway, and why

5-c reads both shapes, strips envelope blocks, keeps the prose, and drops a turn only when nothing
survives. It buys **zero** measured points. It ships because:

- The parser is now correct **by construction** rather than by accident. Today the array-only read
  happens to exclude only machine text. The day Claude Code writes an ordinary prompt as a string,
  recall goes blind to it and nothing in `doctor`, the eval, or the hooks would say so.
- `ide_opened_file` was a **top-20 corpus term at df 4** — harness plumbing indexed as if it were
  a subject, diluting the rarity of everything near it. It is now absent from topics entirely.
- 5 of 59 sessions changed stored topics. All five sat at the `TOPICS_N` cap and swapped envelope
  tokens for real ones — the cap was being spent on plumbing.

### The doctor check this produced

```
  ok   sessions storing topics  -- 0 of 59 store nothing (baseline 0)
```

`EMPTY_BASELINE = 0`, and `doctor` FAILS if the count rises. Zero is not an aspiration; it is the
observed floor after 4c-b + 5-c. The only ways it can rise are a parser that stopped reading a
transcript shape, or a keyword rule that got stricter — both silent, both survivable by a green
eval, and both exactly what happened in 5-b. Raise the constant only with a measured reason written
next to it.

### Baseline unchanged from 7e

```
EASY SET          12/15   strict     lenient 13/15
paraphrase bar     0/4
precision         19/19   on 19 silent cases
sessions storing nothing   0 of 59   -- now enforced by doctor
```

---

## 8. Known weaknesses — review these hardest

1. **Cache write race.** `buildCache` reads the whole file, mutates, and writes it back. Two
   concurrent runs (two prompt hooks firing at once) clobber each other. No locking,
   no atomic rename. Not yet observed causing loss — an apparent case turned out to be a read taken
   mid-run — but the hazard is real and unguarded.
2. **Alias input is too thin — the biggest known weakness.** Generated from title + 8 topic terms
   only; the model never sees the conversation. Measured effect is 0/5 -> 1/5 on paraphrases. The
   obvious next step is feeding the stored opening ask and final outcome into the alias prompt, or
   sampling actual turns. Unproven.
3. **Thresholds are hand-tuned on one corpus** (92 sessions, one project, one developer's phrasing).
   `hits >= 2 AND score >= 6` was arrived at empirically after two wrong attempts; the first fix
   created a false negative that the second had to undo. No held-out evaluation set.
4. **Short sessions are invisible** to topic matching, and 60% of the corpus is short.
5. **Quoted text re-triggers.** Pasting previous hook output back into a prompt matches on the
   quoted words.
6. **No cross-machine sharing.** By design, but it means the original handover problem is only
   solved for the same-laptop case.
7. **Enrichment never runs by itself.** New sessions get aliases only when someone remembers to run
   `enrich`, so coverage silently decays.
8. **`SCAN_WINDOW = 30`** silently bounds the startup listing; sessions beyond it are never shown.

---

## 9. Questions for the reviewer

0. **The headline question.** Alias enrichment moved paraphrase recall from 0/5 to only 1/5. Is this
   approach worth continuing to tune, or is the lexical foundation itself the wrong bet?

1. Is lexical matching plus generated aliases the right approach, or should this be embeddings with
   cosine similarity? Embeddings need either a network key or a bundled model, which breaks the
   "two files, Node, nothing to install" property that makes plugin distribution clean. Is that
   trade worth it?
2. Is scoring on the *stored* side alone sufficient, or should query terms be expanded too?
3. How should the cache write race be fixed — atomic rename, a lock file, or per-session files
   instead of one blob?
4. Is a per-prompt hook the right integration point, or should this be a tool the model calls when
   it wants to?
5. Are the thresholds defensible, or is a proper evaluation set needed before trusting them?
6. Should short sessions be summarised by the model to make them findable, or correctly ignored?
