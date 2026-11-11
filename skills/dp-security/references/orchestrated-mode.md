# Orchestrated mode

How `dp-module-review` and `dp-ai-review` behave when `dp-security` dispatches them. Read this when the invocation carries a **brief** (a path to `reviews/.ledger/pending/<cell>.brief.json`). When there is no brief, ignore this file: the skill runs standalone and asks its own questions.

The orchestrator owns the ledger. A reviewer in orchestrated mode **never** runs `begin` or `record` and never edits `reviews/.ledger/`. It returns a report, a sidecar and a verdict, and the orchestrator records them. One writer keeps the ledger consistent and lets a refused record be sent back for repair.

## The brief

Read it first. It is JSON written by `ledger brief`:

| Field | Meaning |
|---|---|
| `cell`, `module`, `layer`, `skill` | what to review, and which skill is being asked |
| `kind` | `full`, `diff`, `interface` or `deps` - see below |
| `reasons` | why this cell is on the list |
| `depth` | `quick` or `deep`: already answered, do not ask again |
| `files`, `file_count`, `files_truncated` | every file in the cell. `files` is capped at 400 names, and `files_truncated` says when it was cut. Use the registry globs to see the rest |
| `changed_files` | files added, modified or removed since the last review |
| `upstream_changed` | for `interface`: the module that changed and the files that changed in it |
| `replay` | earlier open findings to re-test first, each with its recorded `scenario` |
| `carry_forward` | open findings in unchanged files: do not re-review, do not re-report |
| `already_accepted` | findings the user knowingly accepted: do not re-report |
| `next_id` | the first free finding id; count up from it |
| `siblings` | the module's other cells with their state and verdict |
| `prior` | date, verdict, ruleset and report of the last review |
| `ruleset` | the plugin version the review is running under. The sidecar's findings are recorded against it |

## What changes in the skill's steps

- **Step 1 (map):** reuse the cached map. Refresh only a section the brief proves wrong.
- **Step 2 (questions):** skip entirely. Scope, depth and job came from the brief. The job is `+ Security`.
- **Step 3 (surface):** the surface is set by `kind`, not by `git diff`.
- **Steps 4 to 8:** run as written, on that surface, at the brief's depth.
- **Step 9 (report):** write the report and the sidecar below.
- **Baseline files** (`.accepted.json`, `.ai-accepted.json`) still apply. A finding that matches one is emitted with `"baseline": true`.

## Kinds

A cell can be stale for two reasons at once: its own files changed and an upstream module changed. The brief's `kind` follows the larger job, and `upstream_changed` is filled whenever an upstream module changed. **If `upstream_changed` is not empty in a `full` or `diff` brief, also run the interface check below for it, inside the same review.** Recording the review marks the upstream change as seen, so skipping that check would clear the reason without ever examining it.

### `full`

Review every file in `files`. Replay `replay` first (below), then run the normal sweeps, checklists and refutation. This is the first review of a cell, a review after an incomplete one, and a "re-run everything" review.

### `diff`

The cell reviewed before and its own files have changed. Review `changed_files` first and in full, then widen to their direct callers and consumers, as the skills already do for a changed prompt or contract. Do not re-read unchanged files for their own sake. **Replay first.**

A diff review owes an answer for every finding in `replay`. Findings in `carry_forward` are untouched.

### `interface`

Only an upstream module changed. This cell's own files are the same as when it was last reviewed, so do not review them. Check the boundary:

1. In this cell, find every place that calls or imports the upstream module (`upstream_changed.module`).
2. For each, name what the cell **relies on**: that the caller is authenticated, that input is validated, that the tenant is already scoped, a return shape, an error contract, a default, a rate limit.
3. Read `upstream_changed.changed_files` (or the module's public surface if the list is empty) and decide whether each reliance still holds.
4. Report only a reliance that is **now broken or newly unsafe**, with the file and line **in this cell**, the change upstream that broke it, and a concrete failure scenario.

One sweep, one persona (Intruder for security), at most 8 findings, no checklists. If nothing here relies on the changed code, return an empty `findings` list and say so in the report. An empty interface check is a real result.

### `deps`

The `project/deps` cell. Run `dp-module-review` Step 4 item 3 (the stack's audit command, lockfile committed, any dependency from a raw git or tarball URL) and the licence pass (`references/licenses.md`) at the brief's depth. Use the manifest as `file` in each finding. Also report the model SDKs found in the manifests, so the orchestrator can check the registry.

## Replay

For each finding in `replay`:

1. Read the **current** code at `file`. Follow the recorded `scenario` against it: does that input or state still produce that outcome?
2. If `check.regex` is present, use it as a hint only. A pattern that no longer matches is evidence, not proof, because the code may have moved.
3. Decide:
   - **Still reproduces.** Re-list the finding in `findings` with the **same id**. Update `line` if it moved.
   - **No longer reproduces.** List it under `resolved` with `evidence`: the guard, the removed path, or the changed line, as `file:line`. For an AI finding, evidence is code that runs outside the model. A prompt that tells the model to behave is not evidence.
4. Never resolve a finding because the user said it was fixed, because a comment says so, or because the file is large and you did not reach it. If you cannot decide, keep it open and say why.

A finding cannot vanish by omission: `ledger record` refuses a sidecar that leaves a replayed finding in neither list.

## Finding ids

Use `next_id` and count up: `assistant-ai-004`, `assistant-ai-005`. A replayed finding keeps its id. An id is never reused, even after the finding is resolved.

## Delegation between sibling cells

`dp-ai-review` marks the ordinary dimensions `Delegated`. In orchestrated mode, point at the sibling cell and its recorded state from `siblings`, for example `Delegated - assistant/backend: clean, reviewed 2026-11-10`. If the sibling is `never` or `stale`, say so: the dimension is then **not checked**, not delegated.

`dp-module-review` on a hybrid module's `backend` cell notes in its coverage table that the AI-specific dimensions are covered by the `ai` cell, with that cell's state.

## The sidecar

Write it next to the report as `reviews/<cell with / as ->-review-<YYYY-MM-DD>.json`. This is also the schema for a standalone run, so any review can be recorded later.

```json
{
  "schema": 1,
  "cell": "assistant/ai",
  "kind": "diff",
  "verdict": "BLOCK",
  "block_rule": null,
  "complete": true,
  "depth": "deep",
  "report": "reviews/assistant-ai-review-2026-11-11.md",
  "findings": [
    {
      "id": "assistant-ai-004",
      "severity": "High",
      "title": "Crawled page text reaches an HTML sink",
      "file": "services/assistant/llm/answer.py",
      "line": 88,
      "scenario": "A crawled page containing <img onerror=...> flows through answer() into render_html() unescaped.",
      "fix": "Escape in render_html(), or render as text.",
      "check": { "regex": "render_html\\(answer", "file": "services/assistant/llm/answer.py" },
      "status": "CONFIRMED",
      "baseline": false
    }
  ],
  "resolved": [
    { "id": "assistant-ai-001", "evidence": "services/assistant/llm/answer.py:91 now escapes before render_html()" }
  ],
  "refuted": []
}
```

| Field | Rule |
|---|---|
| `id` | letters, digits, `.`, `_`, `-`. Stable across runs |
| `severity` | `Critical`, `High`, `Medium` or `Low` |
| `file` | relative to the project root, forward slashes, no `..`. The file the finding lives in: the ledger watches it |
| `scenario` | required. The concrete failure a later run replays. No scenario, no finding |
| `fix` | optional. The smallest change that closes the finding |
| `also` | optional. Other files the finding lives in. A change to any of them re-queues it |
| `check` | optional: `{ "regex": "...", "file": "..." }`. `check.regex` is a narrow pattern matching the vulnerable line. It must be cheap: no nested quantifiers. A hint for the replay, never proof |
| `status` | `PROVEN`, `CONFIRMED`, `CONFIRMED (static)` or `PLAUSIBLE`. For the audit trail. The ledger does not read it |
| `baseline` | `true` when the finding matched the skill's baseline file |
| `refuted` | findings the refutation pass rejected, with evidence. The ledger ignores it and the audit keeps it. `dp-ai-review` already requires this |
| `block_rule` | set only when `BLOCK` comes from something that is not a finding, such as a failing build. Otherwise the ledger derives the verdict from the findings |
| `complete` | `false` if the review stopped early. An incomplete cell stays on the next plan |

## Sidecars written before this contract

`dp-ai-review` has already produced a sidecar in a different shape: `schema: "dp-ai-review.sidecar/1"`, findings with `sev` and `where` (a list of `path:lines` strings relative to the component) and no `scenario`, plus `refuted`, `probes` and `trust_boundaries`. `ledger import` reads it so that finished reviews are not repeated. New reviews must use the schema above. The differences that matter:

- The old shape has **no scenario**, so an imported finding is replayed from its title and the report. Write a real scenario in every new finding.
- `where` may list several files. The ledger keeps the first as `file` and the rest as `also`, and a change to any of them re-queues the finding.
- A finding the sidecar gives no resolvable file (an evidence gap, an owner attestation) is kept with `file: null`. Only a full re-review resolves it.

## What to return to the orchestrator

Exactly four things, in a few lines: the sidecar path, the report path, the verdict with the rule that fired, and whether the review was complete. If a Critical was proven, apply the stop rule of the skill and say so. Do not paste findings into the reply: they are in the report.

## Checkpoint line

```
[x] assistant/ai  diff - replayed 1 (resolved 1) - 2 new - BLOCK (rule: unsanitised sink)
```
