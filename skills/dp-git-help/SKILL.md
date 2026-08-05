---
name: dp-git-help
description: Explain the current git branch state against the remote — up to date, behind, diverged, or conflicted — and what to do next. Never resolves a merge/rebase conflict itself, only explains it. Use when the user asks whether it's safe to push, why a pull or push failed, what a merge conflict means, or generally "what's my git state".
argument-hint: ""
disallowed-tools: Edit, Write, NotebookEdit
---

# /dp-git-help — explain the git state

This skill explains; it does not fix. The one hard rule: **never resolve a conflict.**
That includes not running `git checkout --ours/--theirs`, not editing conflicted files,
not `git add`-ing a conflicted path, and not running `merge --continue` /
`rebase --continue` / `--skip`. Resolution is always the developer's call — this skill's
job stops at making sure they understand what they're looking at.

## 1. Gather state

- `git status` — working tree state, and whether there's an unmerged/conflicted path.
- `git fetch` — updates remote-tracking refs so the comparison below is current (this
  only touches remote-tracking refs, not the working tree or local branches — safe).
- `git rev-list --left-right --count HEAD...@{u}` (or equivalent) — how far ahead/behind
  the local branch is from its upstream. If there's no upstream configured, say so and
  stop here with the command to set one (`git push -u origin <branch>`), rather than
  guessing what the intended remote branch is.

## 2. Classify and respond

Exactly one of these applies:

### Conflicted (unmerged paths present)

- Name every conflicting file from `git status`.
- For each one, explain what the conflict is about in plain terms — which two sides are
  disagreeing (e.g. "your branch changed the function signature; `main` deleted the same
  function") by reading the conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) in the
  file, not by guessing.
- State whether this is mid-merge or mid-rebase (`git status` says which), since the
  abort command differs (`git merge --abort` vs `git rebase --abort`).
- **Stop.** Do not edit any file, do not stage any conflicted path, do not continue or
  abort the operation yourself. Tell the developer their options (resolve manually and
  continue, or abort with the exact command) and let them choose.

### Behind (or diverged — behind AND ahead)

- Explain how many commits behind (and ahead, if diverged) and why that matters for
  pushing (a non-fast-forward push will be rejected).
- Check `CLAUDE.md` at the repo root for a stated pull/rebase preference. If it states
  one, recommend that with the exact command. If it doesn't say, present both options
  with their exact commands and a one-line tradeoff each:
  - `git pull --rebase origin <branch>` — keeps history linear, rewrites local commits.
  - `git pull origin <branch>` — merge commit, preserves local commit hashes.
- Do not run either yourself — this skill only explains and suggests.

### Up to date (or ahead only, no conflicts)

- If local == remote exactly: say so, nothing to push or pull.
- If ahead only (nothing to pull, unpushed local commits): confirm it's safe to push and
  give the exact command (`git push origin <branch>`, or `git push` if upstream is
  already tracked).

## 3. Keep it short

The developer asked a status question, not for a git tutorial. State the classification,
the relevant facts (file names, commit counts), and the exact command(s) — skip
background explanation of how git works unless the developer asks a follow-up.
