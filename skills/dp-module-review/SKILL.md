---
name: dp-module-review
description: The single review gate for any codebase. Reads the project once and caches what it learns, then asks module, layer (frontend / backend / database / all), depth (quick / deep), and job (code review / + security / + HTML report). Runs unguided sweeps first and checklists as a safety net, batches refutation by file to keep cost low, proves Criticals against a running instance, and writes a ranked report with a ship / don't-ship verdict. Use for any code review, security review, pre-merge check, module audit, handover or zip-drop review, or review report.
---

# Module Review

One gate for any stack. Read the project once, ask four questions, run only what the answers require.

## Four rules that override everything

1. **Search before checking.** The unguided sweeps are the primary reviewer; the checklists are the safety net under them. A review that finds only checklist items has under-reviewed.
2. **Detect, never assume.** Stack, tooling, conventions - read them from the project. Never hardcode a language's tools.
3. **Run quiet.** Background agents, checkpoint lines only, no transcripts in chat. The report is the deliverable.
4. **Stop when more information cannot change the verdict.** One proven Critical means BLOCK. Do not spend another million tokens refining a decision already made.

---

## Step 1 - Project map (cached)

Look for `reviews/.project-map.md` first.

**If it exists**, read it (~2k tokens) and check staleness cheaply: has the dependency manifest or the top-level folder list changed since it was written? Unchanged - reuse it. Changed - refresh only the affected section.

**If it does not exist**, build it once and write it:

- Stack, via `references/toolchain.md` detection, plus available lint / SAST / audit tools
- **Repo shape and layers present** - `toolchain.md` §4. Record which of frontend / backend / database actually exist. In a monorepo, record this **per package**.
- Module list: name -> paths
- Conventions observed from `references/project-context.md`
- What automation already covers (CI, hooks, linter)
- Risk ranking of areas

Also read `CLAUDE.md` / `AGENTS.md` / ADRs if present - the project's declared rules outrank anything inferred.

Two rules that come out of this and bind every later pass:
- **If CI or a linter already blocks it, do not report it.**
- **If the project deliberately rejected a practice, do not relitigate it.**

If the project has no `CLAUDE.md`, mention once at the end that one would make every future session cheaper. Do not create it unasked.

## Step 2 - Ask four questions

One **AskUserQuestion** call. Options come from the cached map, so they are accurate and free.

Ask **only** the questions the project makes meaningful. Every question you can answer from the cached map is a question you do not ask.

**1. Module** - **the question tool allows at most 4 options, so never just dump the module list into it.** Most projects have more modules than that, and silently dropping half of them is a real failure - the user cannot pick what they cannot see.

When more than three modules exist:

1. **Print the full numbered list first**, as plain text in the chat - every module with its one-line description. This costs almost nothing and guarantees nothing is hidden.
2. **Rank by relevance**, in this order: modules touched by the current diff, then modules changed most recently, then highest-risk areas.
3. **Offer the top three ranked options plus "Whole app"**, and say in the question text: *"or type any name or number from the list above"*. The free-text answer covers everything the four slots cannot.

If a diff exists, relevance is nearly always decisive - the modules it touches are the ones to offer, and there are usually one or two.

In a monorepo this is the package question, asked first, since the package determines everything below.

**2. Layer** - offer **only the layers the repo actually has**, from the shape detection in Step 1.

- Backend service with no view layer: offer `Backend` / `Database` / `Both`. Never mention frontend.
- Static site: skip this question entirely - state "frontend only" and move on.
- Library or infrastructure repo: skip it; run correctness, quality, security and dependencies instead.
- Only one layer present: do not ask. State it and continue.

**3. Depth**

| | What runs |
|---|---|
| **Quick** | 2 sweeps + Tier 1 checklists only + batched refutation |
| **Deep** | 3 sweeps + Tier 1 and 2 + `claude-security` + proofs + batched refutation |

**4. Job** - `Code review` (correctness, gaps, quality) / `+ Security` (adds security passes and dependency audit) / `+ HTML report` (also published as an Artifact).

Confirm scope and estimated cost in one line before starting.

## Step 3 - Surface

- **Git repo** - `git diff <base>...HEAD --name-only`. Fetch first so the base ref is current; a stale local ref silently changes the surface. State file count and changed lines in one line.
- **No repo** - the module directory. Record that history is unavailable, so secret scanning covers the snapshot only.

Reviewing a diff is both cheaper and better than reviewing a tree. Always prefer one.

**Then classify the surface by file type** and drop any pass with nothing to read. Even at layer `All`, a diff of only server files gets no frontend pass; a diff with no schema or migration files gets no database pass. Each skipped pass is recorded in the coverage table as `N/A - no <layer> files in surface`, which is both honest and free. Firing a frontend agent at backend-only changes wastes tokens and produces noise.

## Step 4 - Deterministic scans

Detect tools with `references/toolchain.md`. Use what is installed, never install, and record honestly what is missing.

1. **Lint / typecheck / build / tests** - prefer the project's own scripts. No tests or no linter is itself a finding.
2. **Secrets** - `gitleaks` or `trufflehog` if present, else grep for credential patterns and committed key files. In a git repo, scan history too.
3. **Dependencies** - the stack's audit command. Lockfile committed? Any dependency from a raw git or tarball URL?
4. **SAST** (security jobs only) - the stack's tool, or `semgrep` with explicit rule packs. Never `--config=auto`.
5. **Leftovers** - debug output, commented-out blocks, `TODO`/`FIXME`, hardcoded hosts and test accounts.

Feed every result into the agent briefs as *"already found, do not re-report"*. Deterministic tools should prune model work, not run beside it.

## Step 5 - Sweeps (primary, run first)

Unguided agents with **no checklist**. This is where unknown problems are found, so it gets the larger share of the budget and the looser caps.

Quick runs 2 personas, Deep runs 3. Pick the personas that fit the module:

| Persona | Brief |
|---|---|
| **Operator** | *"You are paged at 3am when this breaks. What breaks, and what makes it hard to diagnose?"* |
| **Intruder** | *"You hold a stolen low-privilege login. What can you reach, change, or read that you should not?"* |
| **Domain expert** | *"You are the person who owns this domain - the accountant, the scheduler, the auditor. The output is wrong. Trace it and find out why."* |
| **Successor** | *"You must change this in six months. What will hurt, mislead, or break silently?"* |

Match personas to the repo shape too: a static site has no Intruder surface worth the pass (use Operator and Successor); an API service has no meaningful UI domain, so point the Domain expert at the contract and the data instead.

Always include the **Domain expert**, adapted to what the module actually does - it finds the wrong-numbers and wrong-rules class that no generic list contains. Add **Intruder** whenever the job includes security.

Every sweep brief ends with:

```
Report only what a generic checklist would MISS. If a standard security or
quality checklist already covers it, skip it.
Read the actual code before claiming anything. Never infer a bug from a file,
route, or function name.
Every finding: file:line + severity + claim + concrete failure scenario
(specific input or state produces a specific wrong outcome) + concrete fix.
No failure scenario means do not report it.
Already found by tooling, do not re-report: <scan results>
LIMITS: up to 20 files, up to 12 findings, highest-risk areas first.
```

Where a web search tool is available, let sweeps check advisories and known pitfalls for the exact framework and library versions in the manifest. That is the only route to problem classes newer than the model's knowledge.

## Step 6 - Checklists (safety net, run second)

Now catch the boring-but-critical items a sweep skims past. These are mechanical, so they get hard caps.

**Quick** - Tier 1 sections only, one agent per selected layer plus one for correctness and gaps.
**Deep** - Tier 1 and Tier 2, one agent per dimension: correctness, gaps, quality-tests, the selected layer files, and security (outsider and insider framings) when the job includes security.

Every checklist brief:

```
The sweeps already found: <one-line summary of each>. Do not re-report those.
Work your reference file item by item. For each item, either report a finding
or record it as clean - the coverage table depends on it.
Same finding format and evidence rules as above.
LIMITS: up to 12 files, up to 8 findings, highest-risk first.
Partial coverage stated honestly beats full coverage claimed falsely.
```

At **Deep + security**, also run the `claude-security` plugin as an independent second opinion - different agents, different method, its own code-computed verification. Its findings skip Step 7; merge them in and mark the source.

Do not run `/code-review` or `/security-review` here. They duplicate these passes at real cost.

## Step 7 - Refute, batched by file

Never one agent per finding - that is where cost explodes. Group findings by file, one agent per file, **maximum 10 agents**. A refuter holding the whole file also judges better than one seeing a snippet.

```
File: <path>
Findings claimed here:
1. L<line> - <claim>
2. ...

Read the ENTIRE file plus what it directly calls. For each finding, try to
REFUTE it: find the guard, middleware, framework default, validation at the
caller, or DB constraint that makes it wrong. Default to REFUTED if uncertain.

Return one line per finding:
<n> | REFUTED|CONFIRMED|PLAUSIBLE | <evidence with file:line>

Add no new findings. Restate nothing.
```

Drop refuted findings silently - they do not appear in the report. De-duplicate: one root cause is one finding with several examples.

## Step 8 - Prove the Criticals (Deep)

A wrong Critical destroys trust in the whole report. For each Critical, and any High claiming an auth bypass, reproduce it in a **safe local environment only** - never staging, production, or a system the user does not own.

- Run locally or in a container against a throwaway database.
- Exercise the path with the project's own client or a plain HTTP request: unauthenticated call, another user's record id, the malformed input.
- Record the actual response.

Label these `PROVEN` with repro steps. If the app cannot be started, say so and mark `CONFIRMED (static)` - never invent a result.

**Then apply rule 4:** once a Critical is proven the verdict is BLOCK. Ask before spending more.

## Step 9 - Report

Write `reviews/<module>-review-<YYYY-MM-DD>.md` using `references/report-template.md`, plus a JSON sidecar with stable finding ids. Give the user the path and the verdict inline - the only long output allowed in chat.

**Verdict is a rule:**

| Condition | Verdict |
|---|---|
| Any Critical, or a High that is auth bypass or data leak | `BLOCK` |
| Any unmitigated High, or failing build/tests | `BLOCK` |
| Only Medium and Low, or Highs explicitly accepted | `SHIP WITH FIXES` |
| Nothing above Low, coverage table complete | `SHIP` |

An incomplete review caps at `SHIP WITH FIXES` regardless of findings. Name which rule fired.

The **coverage table** lists every dimension as pass / fail / N/A / **not checked and why**, plus which tools and plugins ran. Silent omission is not allowed. A **Not reviewed** section states skipped files, missing tools, and unavailable history.

**HTML report job:** also publish as an Artifact - load `artifact-design` first, keep the same structure, hand back the URL.

**Baseline:** `reviews/.accepted.json` holds consciously accepted findings by id. Matched ids are suppressed to one line - `N previously accepted findings suppressed` - so re-runs show what is new. Offer to add one when the user says a finding is intentional; never add unprompted.

## Step 10 - Learn

When a sweep finds a class the references do not cover, append it to the right file's **Tier 1** list, phrased generically, and say in one line what was added. The checklist is the memory; the sweep is the search. A list that never grows is the one that limits you.

Also refresh `reviews/.project-map.md` if the review revealed the map was wrong.

## Step 11 - Offer, do not act

Offer: apply fixes, re-run against the baseline, or accept a finding. Do not edit code during a review.

**Fix mode, when asked:** hand off to `dp-module-fix` via the `Skill` tool, passing the report path. It collapses the findings to root causes, fixes them grouped by file, verifies each one against its own failure scenario, and keeps a resumable fix log. Do not fix findings inline here - a review that also edits is a review nobody can check.

## Checkpoint format

```
[x] Project      cached map - <stack> - lint/SAST/tests: <what exists>
[x] Scope        <module> / all / quick / review+security - 12 files, 380 lines - est ~200k
[x] Scans        build ok - lint 3 warnings - no tests - secrets clean - 2 dep CVEs
[x] Sweeps       operator done - domain expert done - 9 findings
[~] Checklists   security running - correctness done
[x] Refute       14 raised -> 6 survived (batched, 4 agents)
[x] Report       reviews/<module>-review-<date>.md - SHIP WITH FIXES
```
