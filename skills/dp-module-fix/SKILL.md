---
name: dp-module-fix
description: Work through the findings in a review report and fix them - grouped by file, root cause first, each fix verified against the failure scenario that produced it before moving on. Resumable across sessions via a fix log, so a 67-finding backlog does not have to finish in one sitting. Use after dp-module-review, or whenever the user points at a review JSON/markdown pair and asks to fix the findings, work through the TODOs, or clear the backlog.
argument-hint: "[path to a review .json, or a module name — inferred from reviews/ if omitted]"
---

# Module Fix

Turn a review report into merged fixes, without re-reading the same file twenty-two times and without claiming a fix that was never verified.

## Four rules

1. **Fix root causes, not findings.** Twenty findings in one controller are rarely twenty bugs. Collapse them first; a single fix that closes eight findings is the goal, not eight edits.
2. **Group by file, verify by finding.** Open a file once and fix everything in it - but each finding is checked off individually against its own failure scenario. Batching is for reading; verification stays granular.
3. **Verify before moving on.** A fix is not done because the edit was made. It is done when the original failure scenario no longer reproduces and nothing adjacent broke.
4. **Stop and ask on judgement calls.** A behaviour change, a schema change, a dependency upgrade, or anything where the "right" answer is a product decision is the user's call, not yours.

---

## Step 1 - Load the report

Find the pair in `reviews/`: `<module>-review-<date>.json` and the matching `.md`. Newest unless the user names one.

**The JSON is an index, not the content.** It carries `id`, `severity`, `status`, `category`, `file`, `line`, `title`. The failure scenario and the proposed fix live in the markdown, keyed by the same id. Read the markdown section for a finding when you are about to work on it - not all of them upfront, which wastes a large amount of context on findings this session will never reach.

Also load `reviews/.fix-log.json` if it exists (Step 6) and skip anything already resolved.

Report the intake in one line: total findings, counts by severity, how many already resolved.

## Step 2 - Collapse to root causes

Before touching anything, group the findings:

- **Same root cause** - a duplicated permission check appearing in five controllers is one fix with five sites. A wall-clock date resolution used by every screen is one fix.
- **Same file** - findings that share a file get handled in one pass even when their causes differ.
- **Dependent** - one fix makes another finding moot. An unauthenticated route fixed at the router closes every IDOR finding on handlers behind it. Fix the upstream one and re-check the downstream ones rather than editing both.

State the collapse: *"67 findings collapse to 23 root causes across 25 files; 9 of them close more than one finding."* This is where most of the effort disappears, and it should be visible.

## Step 3 - Decide scope with the user

Never start fixing 67 things silently. One **AskUserQuestion**:

**What to fix now** - `Critical + High only` (the blockers), `Everything above Low`, `One file`, or `Let me pick`.

Default recommendation is Critical + High. Mediums are real but they are not why the verdict is BLOCK, and a smaller batch reviews better.

**Handle `PLAUSIBLE` findings separately.** They survived refutation with doubt attached. Do not fix them blind - confirm each one is real first, and drop it from the list if it is not. Fixing a non-bug adds risk for nothing.

Confirm the plan in one line: how many root causes, which files, in what order.

## Step 4 - Order the work

1. **Dependency order first.** Upstream fixes that close downstream findings go first, always. Doing this backwards means writing edits you then delete.
2. **Then severity.** Critical, then High.
3. **Then file clustering** - finish a file before opening the next one.

Say the order before starting so the user can redirect it.

## Step 5 - Fix, one file at a time

For each file in the plan:

**a. Read the file fully** - plus what it directly calls. Once. Everything for this file happens with it in context.

**b. Read the markdown sections** for every finding in this file - scenario, evidence, proposed fix.

**c. Check the project's conventions** (`CLAUDE.md`, neighbouring files, the review's own project map). A fix that introduces a pattern the codebase does not use is a worse fix, even when it is technically correct.

**d. Apply the fixes.** Root cause, not symptom. If the same broken helper is called from five places, fix the helper.

**e. Verify each finding individually:**

| Finding status | How to verify |
|---|---|
| `PROVEN` | Re-run the original reproduction. It must now fail to reproduce. This is the strongest signal available - use it whenever the report recorded repro steps. |
| `CONFIRMED` | Re-read the code path end to end and confirm the failure scenario is now impossible. Name the guard that stops it. |
| `PLAUSIBLE` | Confirm it was real before fixing; if it was not, mark `no_change_needed` with the reason. |

**f. Check the blast radius** - who else calls what you changed? A shared helper touched for one finding can break three callers. Grep for callers and read them.

**g. Run whatever the project has** - tests, linter, typecheck, build. If none exist, say so; do not pretend the change is verified by tooling that is absent.

**h. Record the outcome per finding** - `fixed` / `skipped, reason` / `no_change_needed, reason`. Never silently drop one.

**i. Commit this file's work** as one commit referencing the finding ids. Small, reviewable, revertable. Never commit to a default branch - branch first.

Then, and only then, move to the next file.

## Step 6 - Keep a fix log

Write `reviews/.fix-log.json` after **every file**, not at the end. A 67-finding backlog spans sessions, and losing the state means redoing the analysis.

```json
{
  "source_report": "payroll-payslip-review-2026-08-21.json",
  "root_causes": [
    { "id": "RC-01", "summary": "...", "findings": ["PAY-...-001","PAY-...-014"],
      "files": ["start/routes.js"], "status": "fixed",
      "verified": "unauthenticated GET now 302s to /login (re-ran repro)",
      "commit": "abc1234" }
  ],
  "findings": { "PAY-...-001": "fixed", "PAY-...-002": "skipped: needs product decision on export permissions" }
}
```

Resuming is then: read the log, skip what is resolved, continue. State on resume: *"41 of 67 resolved, continuing with RC-12 in PayslipController.js."*

## Step 7 - Report and re-review

When the agreed scope is done:

- **Summary table** - fixed / skipped / no change needed, with reasons for everything not fixed.
- **What changed** - files touched, commits made.
- **What remains** - the findings deliberately left, and why. Mediums deferred is a legitimate answer; unstated omissions are not.
- **New verdict** - if every Critical and High is resolved and the build passes, the original `BLOCK` no longer holds. Say so, and say plainly that this is a claim about the fixed findings only, not a fresh review.

Then offer to re-run `dp-module-review` **against the baseline** - the fixes should show as resolved, and only genuinely new findings should appear. That is the real confirmation, and it is cheap because the baseline suppresses everything already known.

## Efficiency notes

The cost of a naive fix loop is dominated by re-reading. Four things keep it down:

- **Collapse before fixing.** Fewer, larger fixes beat many small ones - and root-cause fixes are better engineering regardless of cost.
- **One file open once.** Twenty findings in one controller is one read, not twenty.
- **Verify against the scenario, not the whole module.** Re-running an entire review pass after each fix costs more than the review did.
- **Never re-analyse resolved findings.** The fix log exists for this.

Do not batch the *verification* to save tokens. That is the one place where being cheap makes the output worthless.
