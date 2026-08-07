---
name: dp-cpr
description: Draft a commit message and PR description from the current working diff, using the team's templates, with the originating ticket linked and a test summary included. Use when the user is ready to commit, wants a commit message, or wants to open/draft a pull request.
argument-hint: "[ticket key, if not inferable from the branch name]"
---

# /dp-cpr — commit message and PR description

CPR = **c**ommit + **p**R. This skill drafts text; it does not push or open a PR on its
own. Stage/commit only happens if the developer explicitly confirms — see step 5.

## 1. Read the diff

Run `git diff` (unstaged) and `git diff --staged` (staged). If both are empty, say so
and stop — there's nothing to draft from. If both have content, ask the developer which
scope they mean (staged only, or everything) rather than guessing.

Also run `git log --oneline -5` and `git status` for context on branch state — a
conflicted or mid-rebase tree changes what's safe to say here.

## 2. Find the originating ticket

- If a ticket key is already in the conversation (e.g. from `/dp-ticket` or `/dp-plan`),
  use it.
- Otherwise, try to infer one from the current branch name (`git branch --show-current`)
  — many workflows embed the ticket key there.
- If neither yields a key, ask the developer for it. Do not fabricate a ticket link —
  a wrong link is worse than no link.

## 3. Check the test situation

`../../templates/pr-description.md` doesn't currently have a dedicated testing field,
but flag this plainly in your chat response regardless — it shouldn't get buried:

- If `/dp-agent:dp-plan` ran earlier in this conversation, mention the test results it
  already reported (step 7 of that skill) — don't re-run tests or invent a result you
  didn't actually see.
- If invoked standalone (no prior `/dp-plan` in this conversation), don't run tests
  yourself either — diff the changed test files (filter the diff for test paths) and
  say what was added/modified, plus that they haven't been run in this session, so the
  developer knows to run them before relying on this draft.
- Either way, if the diff touches production code with no corresponding test change,
  say that plainly — the developer decides whether that's intentional, not this skill.

## 4. Draft the commit message and PR description

- Commit message: fill in the shape from `../../templates/commit-message.md` exactly.
  Always append the `DP-Agent: v1` trailer on its own line at the end — this is fixed,
  not part of the team's editable convention, and exists so adoption can be measured
  later with `git log --grep`.
- PR description: fill in the shape from `../../templates/pr-description.md` exactly,
  including the ticket link from step 2. For the `AC` field, use the ticket's acceptance
  criteria (from `/dp-ticket`'s draft, or `/dp-plan`'s AC checklist if that ran) and
  check off only what this diff actually covers.
- If either template still has unfilled `TODO(team)` placeholders, draft using
  reasonable defaults but flag which sections are provisional because the template
  isn't configured yet — don't silently invent team convention to fill the gap.

Present both in full before doing anything else.

## 5. Only commit on explicit confirmation

Do not run `git add`, `git commit`, `git push`, or open a PR unless the developer
explicitly confirms after seeing the draft. If they confirm:

- Stage only the files relevant to this change (never `git add -A`/`git add .` blindly —
  confirm what's being staged if anything looks unrelated to the diff you summarized).
- Commit with the exact message drafted in step 4, unedited unless the developer asked
  for changes.
- Do not push or open a PR unless separately asked — committing and publishing are
  different levels of consequence.

## 6. Offer to continue

After a commit is made (skip this if the developer declined to commit in step 5), ask
(e.g. via `AskUserQuestion`) whether to check the git/branch state now — useful right
after committing, since that's exactly when "is it safe to push" matters. If they
confirm, read `../dp-git-help/SKILL.md` and continue by following it directly — don't
wait for them to separately type `/dp-agent:dp-git-help`. If they decline, stop here.
