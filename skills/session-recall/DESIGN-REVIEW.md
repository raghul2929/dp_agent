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

Four layers now. Only the fourth depends on model judgement.

| Layer | Trigger | Enforced by | Output |
| --- | --- | --- | --- |
| Startup index | session start | `SessionStart` hook | ~12 session titles + topic terms |
| Prompt matcher | every prompt | `UserPromptSubmit` hook | 0–3 pointers, or nothing |
| Summary card | session end | `SessionEnd` hook | one card per session, written once |
| The skill | Claude decides | `description` matching | `outline` / `search` / `show` |

**Three hooks, not two.** `SessionEnd` runs `recall.mjs digest`, which makes ONE `claude -p
--model haiku` call per session and writes a summary card to `~/.claude/recall/<project>/`.
Cards live outside the transcript folder deliberately: Claude Code's `cleanupPeriodDays` sweep
deletes transcripts after 30 days and does not touch that path, so a card outlives the
conversation it came from. `digest --backfill` walks every session, not the 30-file scan window.

**Distribution note — the local-copy detour.** This packet describes the skill as shipped via
`${CLAUDE_PLUGIN_ROOT}` in the dp-agent plugin, and that is still where it lives. But the work
recorded in sections 7 onward was carried out against a **local copy** in a single project
(`zaap-app/.claude/skills/session-recall/`, wired through `.claude/settings.local.json` with
`${CLAUDE_PROJECT_DIR}` paths), because iterating on a plugin means reinstalling it to see each
change. The local copy and the plugin drifted: the plugin sat at `CACHE_V = 2` with no alias
layer while the local copy gained aliases, banner filtering, self-exclusion, transcript-path
resolution and summary cards. They were reconciled by merging back into the plugin, and the
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

### D · Alias enrichment (offline, explicit)

```
recall.mjs enrich [n]
     |
     |  for up to n sessions with >= 6 turns and no aliases yet:
     v
claude -p "10 alias keywords for: title=... subject=..." --model haiku
     |
     |  RECALL_NO_ENRICH=1 in the child env
     |  (the child is itself a session -> fires SessionStart -> would recurse)
     v
store phrase + its word parts in .recall-topics.json
```

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
| 349 | `aliasesFor` | `claude -p` alias generation, recursion-guarded |
| 400 | `buildCache` | mtime + version keyed cache, optional enrichment budget |
| 460–500 | `queryTerms`, `cmdMatch` | scoring and thresholds |
| 540 | `cmdHook` | stdin entry point, never throws |

### Key constants

```
SCAN_WINDOW = 30      files parsed at session start
CACHE_V     = 3       bump invalidates every cached entry
topics      = 14      terms stored per session
gist cap    = 200     chars for ask / outcome
threshold   = hits >= 2 AND score >= 6
rarity      = df <= 2 -> x2,  df <= 5 -> x1.5,  else x1
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

### Verdict

Lexical matching over model-written cards moved paraphrase recall from unreachable to nearly
reachable: baseline misses scored ZERO, whereas the remaining misses now rank first or second and
fall short only at the threshold. It did not reach 3/4, and the single lever that does reach it
costs a quarter of the system's silence. The next step is local embeddings over the same cards.
Nothing else needs to change: cards, the digest pipeline, all three hooks, `--backfill`,
`--upgrade` and this eval harness are all representation-agnostic; only `cardCandidates` computes
similarity.

## 8. Known weaknesses — review these hardest

1. **Cache write race.** `buildCache` reads the whole file, mutates, and writes it back. Two
   concurrent runs (a prompt hook firing while `enrich` is running) clobber each other. No locking,
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
