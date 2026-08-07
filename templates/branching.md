<!--
Drafted from a provided team rules doc. TODO(team): confirm the <type> set and
the ticket-key-in-branch-name convention actually match how the team works —
this is a real starting point, not an invented guess, but check it.
-->

# Branching Strategy

## Before starting any ticket

```
git checkout main
git pull origin main
git checkout -b <type>/<TICKET-KEY>-<ticket-no>-<short-title>
```

- `checkout main` first — your last branch may still have unmerged code sitting in it.
- `pull origin main` before branching — branching off a stale `main` just means
  conflicts later that didn't need to happen.
- Never work directly on `main`.

## Branch name

`<type>/<TICKET-KEY>-<ticket-no>-<short-title>` — e.g. `feat/PROJ-123-456-otp-login`.

<!-- TODO(team): confirm <TICKET-KEY> and <ticket-no> are actually two different
     things here (e.g. a Jira key vs. a separate tracker's card number) and not
     the same number twice — if your ticket key already contains the number
     (like "PROJ-123"), drop <ticket-no> and use just <TICKET-KEY>-<short-title>. -->

Including the ticket key isn't just for readability — `/dp-agent:dp-cpr` reads it back
out of the branch name to auto-link the ticket later. Skip it and the developer has to
type the key in by hand at commit time instead.

`<type>`, mapped from the ticket's classification (`/dp-agent:dp-ticket` already
produces this):
- `feat` — feature
- `fix` — bug
- `refactor` — improvement that doesn't change behavior
- `hotfix` — urgent production fix (TODO(team): what makes something a hotfix vs. fix?)
- `chore` — dependency bumps, tooling, non-product work

## Keeping the branch current while you work

| When | Do |
|---|---|
| Every morning | `git pull --rebase origin main` |
| Before raising the PR | `git pull --rebase origin main` |
| Conflict shows up mid-rebase | fix the files → `git add .` → `git rebase --continue` |
| Rebase goes wrong | `git rebase --abort` — you're back to where you started, safely |
| Already pushed, then rebased | `git push --force-with-lease` — never plain `--force` |
| Branch is shared with someone else | merge instead of rebasing it |

`/dp-agent:dp-git-help` follows this table when it recommends pull vs. rebase — keep it
in sync here if the team's actual preference ever changes.
