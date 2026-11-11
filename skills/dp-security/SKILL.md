---
name: dp-security
description: One entry point for security checks on any project - normal, AI, or hybrid. Reads the project once, splits it into modules and layers (frontend, backend, database, ai, infra), asks the scope once (full / normal only / AI only / module-wise), runs dp-module-review and dp-ai-review on each piece, and records progress in a ledger. Every later run re-checks only what changed or is still failing, skips what already passed, and checks only the new module or the new package when one appears. Use for "run a security check", "security review of the whole project", "what is still failing", "re-check after my fixes", "check the new module", "re-run everything", or "show security progress".
---

# Security Check

One command for the whole project. Split it into cells, review each cell with the right skill, record the result, and next time review only what needs it.

A **cell** is one module in one layer: `assistant/backend`, `assistant/ai`, `web-ui/frontend`. `ai` is a layer, not a project type, so a hybrid module simply has an `ai` cell next to its `backend` cell. Every cell has its own fingerprint and its own state: `never`, `clean`, `open`, `accepted`, or `stale`.

In this skill, `ledger <command>` means `node "${CLAUDE_PLUGIN_ROOT}/skills/dp-security/ledger.mjs" <command>`, run from the project root. It needs Node 18 or newer. If `node --version` fails, say so and stop. Do not fall back to guessing what changed.

## Six rules that override everything

1. **The ledger decides what to skip. You never do.** Run `ledger plan`. Never skip a cell because it "looks unchanged" and never re-run one because it "feels stale". A wrong skip is a missed vulnerability, and hashing is exact where judgement is not.
2. **A finding closes by evidence, not by a claim.** "I fixed it" changes nothing until the file changes and the replay or re-review no longer reproduces it. Never edit files under `reviews/.ledger/` by hand. Use `record`, `accept` and `reopen`.
3. **Clean is not secure.** Say "no findings under ruleset X on DATE". Per-cell reviews miss bugs that span modules, so a full re-run before release is the real gate.
4. **Do not create or edit `CLAUDE.md`.** The module registry is machine-owned and lives in `reviews/.ledger/registry.json`. The human view is `reviews/security-progress.md`. Both are kept current for you. A hand-written `reviews/PROGRESS.md` is the user's: the tool never writes to that name and refuses to overwrite any file it did not generate.
5. **Record each cell the moment it finishes**, not at the end. A run that is killed then resumes where it stopped, because `ledger plan` shows interrupted cells as `RESUME`.
6. **Run quiet.** Checkpoint lines only, no transcripts. `reviews/security-progress.md` and the per-cell reports are the deliverable.

Reviews run outside this skill (a plain `/dp-module-review` on a PR diff) are **not** recorded. The ledger only trusts reviews it dispatched, because a diff review does not cover a whole cell.

---

## Step 1 - Which run is this?

Check for `reviews/.ledger/registry.json`.

- **Missing** - first run. Go to Step 2.
- **Present** - later run. Go to Step 5.

## Step 2 - Read the project once (first run)

1. **Scan, then maps.** Run `ledger scan`. It needs no registry and no model: it lists the manifests, the top-level layout with file counts, and any model SDK in a manifest or any file importing one. Then build `reviews/.project-map.md` by `dp-module-review` Step 1. If the scan reports AI signals, also build `reviews/.ai-map.md` by `dp-ai-review` Step 1 (`dp-ai-review/references/ai-surface.md` lists further signals the scan does not look for, such as non-text inputs, training code and tool definitions). If the scan reports none and the maps find none, say "no AI layer detected" and carry on with the ordinary layers only.
2. **Registry.** Derive modules, layers, globs and `depends_on` using `references/registry.md`. Store it with `ledger registry set -` (JSON on stdin).
3. **Verify the split with code, not trust.** Run `ledger registry check` and `ledger coverage`.
   - A cell that "matches no files" is a wrong glob. Fix it.
   - **Uncovered code or config files** have no reviewer. Add each to a layer (CI and Docker files fit an `infra` layer) or to `ignore`, and say which.
   - **AI code outside every `ai` layer** was never read by `dp-ai-review`. Add the files to an `ai` layer.
   - Repeat until both are empty, or the user says a file is intentionally out.
4. **Show and confirm.** Print a table of module, layers, one-line description and `depends_on`, then ask once (AskUserQuestion), two questions in one call:
   - *"Is this module split right?"* - `Looks right` / `I'll correct it`. A wrong split poisons everything after it, so this is the one question worth a pause.
   - *"Should the ledger be committed to git?"* - `Ask me per project: local only` / `Team: commit it (private repo only)`. Findings in the ledger describe real weaknesses, so a shared or public repo exposes them. Apply the answer to `.gitignore`:
     - **Local only:** ignore `reviews/`.
     - **Team:** commit `reviews/.ledger/registry.json`, `reviews/.ledger/cells/` and `reviews/security-progress.md`. Ignore `reviews/.ledger/pending/` and the per-run reports and sidecars.

   State in one line which lines you added to `.gitignore`.
5. **Import what is already done.** If `reviews/` holds finished reports with a JSON sidecar (`*-review-*.json`), do not pay for them twice. Map each to a cell (an AI review of `apps/foo` is the cell `foo/ai`) and run `ledger import <cell> <sidecar>`. It reads the standard sidecar and the one `dp-ai-review` wrote before this skill existed (`sev`, `where`).
   - Import **refuses** unless the cell's code is proven unchanged since the review's `base_commit`, and names the files that moved. Then the cell is reviewed, not imported.
   - Never pass `--assume-unchanged` unless the user says the code has not changed since the review date.
   - An unfinished review (candidate lists, no verdict, no sidecar) is not a review. Its cell stays `never`.
   - A sidecar has no ruleset, so the record says `unknown`. Pass `--reviewed-ruleset` if the user knows it.

## Step 3 - Ask the scope (once)

One **AskUserQuestion** call. Offer **only the options the registry makes meaningful**. A project with no `ai` cell never sees "AI only".

**1. Scope**

| Option | Cells |
|---|---|
| **Full** (recommended) | every cell, plus the dependency audit |
| **Normal only** | every cell except `ai`, plus the dependency audit |
| **AI only** | every `ai` cell |
| **Module-wise** | the modules and layers you name |

For module-wise, the question tool allows four options, so never dump the module list into it. Print the full numbered list first, rank by relevance (changed most recently, then highest risk), offer the top three plus "Whole app", and say *"or type any name or number from the list above"*. The answer maps to `module:<name>` or `module:<name>:<layer>+<layer>`.

**2. Depth** - `Quick` or `Deep`, defined as in `dp-module-review` Step 2. Recommend **Deep** when the AI map shows autonomy L3 or L4, tenant-scoped retrieval, an anonymous audience, stakes above `none`, or commitments = yes, and say why in the question text. One answer applies to every cell.

**3. Job** - `Review + security` (the default for this skill) / `+ HTML report`.

Confirm in one line: the number of cells and their ids. Do not quote a token or cost estimate you have not measured.

## Step 4 - Dispatch

Run `ledger plan --scope <scope> [--rerun-all] [--no-dependents]` and print the work list. It is already in dependency order. For each cell in it:

1. `ledger brief <cell> [--depth quick|deep] [--rerun-all] > reviews/.ledger/pending/<cell with / as __>.brief.json`. The brief is the work order: files, findings to replay, what is already accepted, the next finding id.
2. `ledger begin <cell>`. This snapshots the cell **before** the review, so a file edited during the review is not blessed.
3. Invoke the skill named in `brief.skill` with the **Skill** tool, in orchestrated mode. Pass the brief path, the depth and the job. The skill follows `references/orchestrated-mode.md` and returns a report path, a sidecar path, a verdict and the rule that fired. For `project/deps`, the skill is `dp-module-review` and the kind is `deps`.
4. `ledger record <cell> --kind <brief.kind> --findings <sidecar> --verdict <verdict> --depth <depth> --report <report>`, adding `--block-rule "<why>"` if BLOCK comes from something that is not a finding (a failing build), and `--incomplete` if the review stopped early.
   - If `record` refuses with *"earlier open findings not accounted for"*, send the cell back to the reviewer to replay those findings. Never edit the sidecar to make it pass.
   - Warnings from `record` (a stricter reported verdict, a missing report file) are shown to the user as they are.
5. Print one checkpoint line.

Cells that are not related by `depends_on` may run in parallel as background agents, at most four at a time. Never start a dependent before its dependency is recorded.

**Stop rule.** A cell that ends in `BLOCK` with a proven Critical follows the stop rule of the skill that ran it. After the first such cell, ask once whether to continue with the remaining cells or stop here, and remember the answer for the run. The overall verdict cannot improve, but the user may still want the rest of the list.

## Step 5 - Later runs

1. **Refresh the registry cheaply.** Run `ledger coverage`. New top-level folders, new manifests, files in no cell, a model SDK that appeared in a manifest, or AI files outside every `ai` layer all mean the registry needs a change. Propose it, confirm with the user, then `ledger registry set -`. Never change the registry silently. A new module only creates new cells, and a new `ai` layer starts at `never`.
2. **Plan.** Run `ledger plan`. Print the line *"Needs work: N cells - skipped unchanged: M"* with the reasons. Also relay any note about uncovered files, orphan records and cells reviewed under an older ruleset. An older ruleset is information, never a forced re-run.
3. **Ask once** (AskUserQuestion), only if there is something to choose:
   - `Recommended` - every cell that needs work, dependents included (default)
   - `Pick modules` - same module-wise handling as Step 3
   - `Re-run everything` - `--rerun-all`; the "version 2" option
   - `Stop here`

   If nothing needs work, say so, show `ledger status`, and offer `Re-run everything` or stop.
4. Dispatch as in Step 4. A cell whose own files changed is reviewed as a **diff**, with its earlier findings replayed first. A cell whose upstream module changed gets a small **interface check**. A cell that is stale only because the dependency audit aged past 14 days gets just the audit.

## Step 6 - Report

`ledger record` rewrites `reviews/security-progress.md` every time, so it is always current. At the end run `ledger status` and give the user:

- The **overall verdict**. `BLOCK` if any cell blocks. `INCOMPLETE` if no cell blocks but some are `never` or `stale`. Otherwise `SHIP WITH FIXES` or `SHIP`. A project with stale cells is never reported as `SHIP`.
- Open findings by severity, and the path `reviews/security-progress.md`.
- The line *"Next run will do: N cells - skip: M"*.

**HTML report job:** also publish as an Artifact. Load `artifact-design` first, build it from `security-progress.md` and the per-cell reports, and hand back the URL.

## Step 7 - After the fixes

The user fixes code and runs `/dp-security` again. The ledger sees the changed files, so the cell is reviewed as a diff, the earlier findings are replayed, and each one either still reproduces or is resolved with evidence.

Offer, do not act:

- **Accept a finding:** `ledger accept <cell> <id> --reason "..." [--days N]`. A reason is required. A Critical cannot be accepted. An acceptance lapses when the finding's file changes or after 90 days, whichever is first. Never accept unprompted, and when the stated reason is a prompt-only control, record it as accepted risk and not as a fix.
- **Reopen:** `ledger reopen <cell> <id>`.
- **Fix mode:** if a fix skill is installed, hand off to it with the report path, as `dp-module-review` Step 11 does. Otherwise fix in severity order, one finding at a time, and verify the original failure scenario no longer holds. Never claim a fix you did not verify.

## Before a release

Per-cell tracking is for day-to-day work. For the release gate, choose `Re-run everything` at Deep, then `ledger status --check --strict`. That fails on any stale cell, any open finding of High or above, any BLOCK rule, files that no cell reads, and AI code outside an `ai` layer.

## In CI

`ledger status --check` calls no model. It exits `1` when a cell is stale or has an open High or Critical, and `0` otherwise, so a pipeline can enforce "nothing merged with an unreviewed change". Add `--allow-stale` to gate on findings only, `--fail-on Medium` to tighten the threshold, and `--strict` to include coverage gaps.

## Checkpoint format

```
[x] Registry     5 modules - 7 cells - hybrid: assistant - coverage clean
[x] Scope        full / deep / review+security
[x] Plan         needs work 3 - skipped 4 - deferred 0
[x] project/deps       deps-audit      2 findings    SHIP WITH FIXES
[x] shared-lib/backend review-diff     replayed 1    SHIP
[~] assistant/ai       review-diff     running
[ ] api/backend        interface-check queued
[x] Report       reviews/security-progress.md - overall BLOCK - next run: 4 cells - skip: 3
```

## What this skill does not do

- It does not review code itself. It plans, dispatches and records. The reviewing is `dp-module-review` and `dp-ai-review`.
- It does not edit code during a review.
- It does not prove that a clean cell is secure, and it does not find bugs that live between modules. Those need the full pre-release run.
