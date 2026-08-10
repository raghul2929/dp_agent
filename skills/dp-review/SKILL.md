---
name: dp-review
description: Check whether a GitHub PR's diff stays within the scope of its originating ticket — classifies every changed file as in-scope, questionable, or out-of-scope with reasoning, flags anything both out-of-scope and high blast-radius, and offers to hand off to the separate code-review skill for correctness/quality. Use when a reviewer with only high-level context needs to sanity-check a PR raised by someone else — especially a junior teammate — against what the ticket actually asked for, before or instead of a full code review.
argument-hint: "[PR number or URL, e.g. 42 — inferred from the current branch if omitted]"
disallowed-tools: Edit, Write, NotebookEdit
---

# /dp-review — check a PR's diff stays in scope

This skill answers one question: **does this PR only touch what its ticket actually
asked for?** It is not a correctness or code-quality review — that's `code-review`'s
job (a separate plugin's skill, not part of dp-agent). Do not duplicate that work here:
no bug-hunting, no simplification suggestions, no line-level confidence scoring. If
asked for a "full review", do the scope check here and hand off via the
`AskUserQuestion` in step 7 rather than trying to do both jobs in one skill.

## 1. Get the PR

- Parse the argument: a bare PR number (`42`) or a full PR URL — `gh` accepts either.
- If no argument was given, try to infer the PR from the current branch:
  `gh pr view --json number,title,headRefName,body,url`. If that also fails (no PR
  found for the current branch), ask the developer for a PR number or URL — do not
  guess which PR they mean.
- Before anything else, confirm `gh` is usable: if `gh pr view`/`gh auth status` fails
  because `gh` isn't installed or isn't authenticated, say so plainly and stop. Do not
  fall back to a local `git diff` — a local checkout may not match what's actually on
  the PR (rebases, force-pushes, commits since you last fetched), and this skill's
  whole job is checking what's actually up for review on GitHub, not what happens to
  be on disk.
- Once you have a PR number, fetch what you need:
  - `gh pr view <number> --json number,title,body,headRefName,baseRefName,url` — title,
    body, branch name, for ticket inference in step 2.
  - `gh pr diff <number>` — the actual diff to classify in step 4. If it's empty, say
    so and stop — there's nothing to check scope on.

## 2. Get the ticket

Never guess the intended scope from the diff itself — the diff is exactly what you're
checking, not the source of truth for what should be in it.

- Try to infer a ticket key from the PR title first (many teams prefix PR titles with
  `[<TICKET-KEY>]`, the same convention `../../templates/pr-description.md`'s `Title`
  field uses), then from the head branch name (`headRefName` from step 1), using the
  `<type>/<TICKET-KEY>-<ticket-no>-<short-title>` convention
  `../../templates/branching.md` defines and `/dp-agent:dp-cpr` already relies on for
  the same inference.
- Once you have a key (or if the developer gives one directly), fetch the full ticket:
  look for a connected Jira/Atlassian MCP tool via `ToolSearch` (query: `"jira issue"`).
  If found, fetch by key. If none is connected, ask the developer to paste the ticket —
  do not fabricate ticket content, the same rule `/dp-agent:dp-ticket` step 1 follows.
- If no key can be inferred and the developer doesn't have one handy either, stop and
  say scope can't be checked without knowing what the ticket asked for. Don't
  substitute the PR's own description as a stand-in for the ticket — a junior
  developer's own account of what they did is exactly the thing this skill exists to
  check independently, not to trust as the scope definition.

## 3. Read team architecture context

Read `CLAUDE.md` at the repo root, specifically the Architecture section (directory-to-
responsibility mapping) — this is what lets you judge whether a touched file is
plausibly related to the ticket even when the ticket doesn't name it directly (e.g. the
ticket asks for an API change, and the diff also touches the module `CLAUDE.md` says
owns validation for that same API — that's a defensible connection, not scope creep).
If `CLAUDE.md` doesn't exist, or its Architecture section is still `TODO(team)`, say so
and rely on the ticket text alone — don't invent an architecture mapping you haven't
confirmed.

## 4. Classify every changed file

Read `../../templates/scope-review.md` and classify **every file in the diff** into
its three tiers (in scope / questionable / out of scope), each with a one-line reason
per that template's Output shape — a label with no reason isn't a review, don't produce
one. If the template's `TODO(team)` placeholders are still unfilled, say so explicitly
and use your own judgment for that specific call rather than silently picking a
default.

Group files instead of repeating identical reasoning line-by-line — a mechanical rename
across 30 files is one line covering the group with a file count, as long as the
reasoning is genuinely the same for all of them.

## 5. Flag blast radius

For anything classified Questionable or Out of scope, additionally check whether it
also lands in `../../templates/plan-format.md`'s Blast-radius categories (shared/high-
traffic module, hard to reverse, etc.) — per `scope-review.md`'s Blast radius
subsection, this reuses that template's categories rather than redefining them
separately. A file that's both out-of-scope *and* high blast radius is what the senior
reviewer most needs to see first — call that combination out explicitly, don't let it
sit undifferentiated in a list with everything else.

## 6. One summary verdict line

End the scope portion of your response with exactly one line, per
`scope-review.md`'s Output shape:

```
Scope verdict: contained|drifted — <N> questionable, <N> out-of-scope, out of <N> files total
```

`contained` only if every file is in-scope, or every non-in-scope file was already
justified as a defensible drive-by per step 4's reasoning and `scope-review.md`'s
`TODO(team)` guidance. Any unresolved out-of-scope file makes it `drifted` — don't
round up to "contained" because most of the PR looks fine.

## 7. Ask what's next

Always follow the verdict line with an actual `AskUserQuestion` call — don't leave the
reviewer to infer next steps. Offer:

- **Hand off to `code-review` for correctness/quality on this same PR** — a separate
  plugin's skill, not part of dp-agent, so read none of its internals directly; invoke
  it via the `Skill` tool (`skill: "code-review"`), the same way a user would type
  `/code-review`, passing the PR number as its target. This is the expected default
  next step once scope is checked, not an unusual detour.
- **Post this scope summary as a PR comment** (`gh pr comment <number> --body ...`,
  using `scope-review.md`'s Output shape as the comment body) — only if the developer
  explicitly confirms first. Posting is visible to everyone on the PR, including the
  original author, so draft-then-ask applies exactly like `/dp-agent:dp-cpr`'s commit
  step: never post by default, never post just because the verdict was `drifted` and it
  "seemed important enough".
- **Stop here** — the scope check alone was what they wanted.

If they pick both handoff and posting, post first (it's this skill's own output)
before switching into `code-review`.
