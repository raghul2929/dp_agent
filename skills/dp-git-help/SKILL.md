---
name: dp-git-help
description: Explain the current git branch state against the remote — up to date, behind, diverged, or conflicted — and what to do next. Never resolves a merge/rebase conflict itself, only explains it. Use when the user asks whether it's safe to push, why a pull or push failed, what a merge conflict means, or generally "what's my git state".
argument-hint: ""
disallowed-tools: Edit, Write, NotebookEdit
---

# /dp-git-help — explain the git state

This skill explains; it does not fix. The one hard rule: **never resolve a conflict.**
That means never running `git checkout --ours/--theirs`, never editing a conflicted
file, never `git add`-ing a conflicted file, and never running `merge --continue` /
`rebase --continue` / `--skip`. Resolving is always the developer's call — this skill's
job stops at making sure they understand what they're looking at.

**Plain language throughout.** No git jargon the developer has to look up — say what's
actually true in the simplest words that are still accurate. If a term needs a footnote
to explain, don't use the term, describe the situation instead.

## 1. Look at the current state

- `git status` — is anything uncommitted? Is anything conflicted?
- `git fetch` — checks what's new on the remote so the comparison below is accurate
  (this doesn't change any of your files, just updates what git knows about the remote).
- `git rev-list --left-right --count HEAD...@{u}` (or equivalent) — how many commits
  ahead/behind you are. If there's no upstream set yet, say so and stop here with the
  command to set one (`git push -u origin <branch>`) rather than guessing.

## 2. Figure out which case this is

Check in this order — first match wins, so uncommitted changes get handled before
talking about ahead/behind, and a conflict comes before everything else:

### You have a conflict

- Name every file with a conflict, from `git status`.
- For each one, explain in plain terms what's disagreeing — read the actual conflict
  markers (`<<<<<<<` / `=======` / `>>>>>>>`) in the file and describe both sides (e.g.
  "your branch renamed this function; the other branch deleted it"), don't guess.
- Say whether this happened during a merge or a rebase (`git status` tells you which),
  since the command to back out differs (`git merge --abort` vs `git rebase --abort`).
- **Stop there.** Don't edit the file, don't stage it, don't continue or back out of the
  merge/rebase yourself. Give the developer their two options — fix it by hand and
  continue, or back out with the exact command — and let them pick.

### You have uncommitted changes (and no conflict)

This is the normal state right after `/dp-agent:dp-cpr` if the developer didn't commit
during that step. Keep this one simple, one clear path forward:

- If `/dp-agent:dp-cpr` already wrote a commit message earlier in this conversation,
  say so and ask (via `AskUserQuestion`) whether to save and push now using that exact
  message. If yes: save only the files that message was written for, commit with that
  message unchanged, then push. If no: just show the three commands so they can run
  them whenever they're ready.
- If no message has been written yet, don't write one yourself — that's
  `/dp-agent:dp-cpr`'s job. Say plainly: "You have changes that aren't saved yet, but no
  commit message has been written — run `/dp-agent:dp-cpr` to write one first."
- If they're also behind (see below), mention it in one line but don't deal with it yet
  — commit first, then come back for the pull.

### You're behind (the remote has commits you don't have)

- Say how many commits behind (and ahead too, if both) and why it matters: pushing will
  be rejected until you catch up.
- Check `CLAUDE.md` at the repo root for a stated preference between these two. If it
  states one, recommend that with the exact command. If not, show both with a one-line
  tradeoff each:
  - `git pull --rebase origin <branch>` — keeps history in a straight line, but rewrites
    your commits.
  - `git pull origin <branch>` — adds a merge commit, but keeps your commits unchanged.
- Don't run either yourself — show the command, let them run it.

### You're up to date (or just ahead, nothing to pull)

- Exactly matching the remote: say so, nothing to do.
- Ahead only (your commits aren't pushed yet, nothing new to pull): say it's safe to
  push and give the exact command (`git push origin <branch>`, or just `git push` if
  already tracking upstream).

## 3. Keep it short

The developer asked a status question, not for a git lesson. State which case it is,
the relevant facts (file names, how many commits), and the exact command(s) — skip
explaining how git works underneath unless they ask a follow-up.
