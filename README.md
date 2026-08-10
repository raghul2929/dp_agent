# dp-agent

A Claude Code plugin that standardises the path from a Jira ticket to a draft merge
request: ticket quality check → implementation plan → commit/PR drafting → git-state
help. **This is not a coding agent** — Claude Code already is one. This is skills,
templates, and hooks on top of it so the workflow is repeatable across a team instead of
depending on each developer's personal prompting habits.

## Quick start

The condensed path from zero to a filled-in `CLAUDE.md`, for teams onboarding onto
dp-agent. Full detail, CLI equivalents, and edge-case caveats live in the sections
below — this is the copy-paste version.

1. **Open a Claude Code session** in the project you want dp-agent in.
2. **Add the marketplace** — in the chat, run `/plugins` → **Marketplaces** tab →
   **Add** → paste `raghul2929/dp_agent`.
3. **Install the plugin** — **Plugins** tab → find `dp-agent` → **Install** → pick
   **"Install for you"** if you want it available across all your projects (user
   scope), not just this one.
4.  VS Code's window reload (Ctrl+Shift+P → "Developer: Reload
   Window").
5. **Verify it loaded** — run `/dp-agent:dp-version`. If it doesn't return a version
   number, go back to step 4.
6. **Set up your repo's conventions** — copy `CLAUDE.md.example` to `CLAUDE.md` at your
   repo root.
7. **Fill it in** — run this prompt from your repo root:

   > Inspect this repo and fill in the TODO blanks in CLAUDE.md under Stack,
   > Architecture, Naming, Testing approach, and PR expectations. Keep the section
   > headers exactly as they are — only replace the blanks. Don't guess anything you
   > can't verify from the code; leave TODO(team) for anything you genuinely can't
   > determine (e.g. branch/PR conventions if there's no git history yet). Once done,
   > delete the top HTML comment block.

   Then review what got filled in — don't take it on faith, especially **PR
   expectations**: it's a starting template, not a fixed requirement. If a line doesn't
   match your team's actual process (e.g. you don't require a security review), delete
   or edit it rather than leaving a stale requirement in. If you decide you need
   additional security checks beyond what's templated, add those after you've planned
   and executed your own review process — don't block filling in `CLAUDE.md` on
   deciding that policy up front.
8. **Know what each skill is for** before using them:

   | Skill | Purpose |
   |---|---|
   | `/dp-agent:dp-ticket` | Checks a ticket is good enough to build from before anyone starts. |
   | `/dp-agent:dp-plan` | Turns a validated ticket into a repo-grounded implementation plan, then implements it once you approve. |
   | `/dp-agent:dp-cpr` | Drafts your commit message and PR description from the diff, once work is done. |
   | `/dp-agent:dp-git-help` | Explains your git state (behind/diverged/conflicted) in plain language — never resolves conflicts for you. |
   | `/dp-agent:dp-version` | Confirms which plugin version is installed — use this after any update. |
   | `/dp-agent:dp-review` | For reviewers: checks a teammate's PR only touches what its ticket asked for, then offers to hand off to `/code-review` for correctness/quality. Entry point is a PR number, not a ticket. |

   See "The skills" further below for full detail on each, and "Chained flow" for how
   they link together into one guided pass.

## Design

- **Prose lives in `templates/`.** Skill bodies (`skills/*/SKILL.md`) contain flow and
  logic only, and read templates by reference. Tune wording there, not in the skills.
- **Team convention lives in `CLAUDE.md`**, not in any skill. No skill invents naming,
  architecture, or testing conventions.
- **Guardrails are hooks** (`hooks/`), not prompt instructions — they can actually block
  a tool call, not just ask nicely.
- Every template ships as a placeholder with `TODO(team)` markers. Nothing here invents
  your commit format, PR format, or quality bar — you fill those in.

## Install

This plugin is published at `raghul2929/dp_agent` on GitHub — that's the real,
shareable source. A local `--plugin-dir`/local-path install (further below) only works
on the machine that folder lives on; use it for developing dp-agent itself, not for
rolling it out to anyone else.

**CLI:**

```
claude plugin marketplace add raghul2929/dp_agent
claude plugin enable dp-agent@dp-agent-marketplace --scope user
```

(`--scope user` makes it available in every project on your machine; use `--scope
project`, run from the project root, if you want it enabled just for one project and
committed to that project's settings — see "Team-wide" below.)

**VS Code extension**:

1. In the chat box, type `/plugins`.
2. **Marketplaces** tab → **Add** → paste `raghul2929/dp_agent`.
3. **Plugins** tab → find `dp-agent` → **Install** → pick a scope ("Install for you" /
   "Install for this project" / "Install locally").
4. Run `/reload-plugins` in the chat — plugin state doesn't always apply to an
   already-open session without it (see "Caveats" below).

**Local-path install, for developing dp-agent itself** (not for normal use):

```
claude --plugin-dir ./dp-agent
```
or, via `/plugins` → Marketplaces → Add, paste the local folder path instead of the
GitHub reference. Points at whatever's on disk right now, uncommitted changes included.

**Team-wide, so nobody has to do this by hand per project**: the reliable way to produce
this file is to let Claude Code write it itself rather than hand-editing — run this once
from the project root (needs the marketplace already added once, per above):

```
claude plugin enable dp-agent@dp-agent-marketplace --scope project
```

Commit the `.claude/settings.json` this generates — confirmed by hand to be exactly:

```json
{
  "enabledPlugins": { "dp-agent@dp-agent-marketplace": true }
}
```

`enabledPlugins` is a record (`{"plugin@marketplace": true}`), not an array or a
top-level `extraKnownMarketplaces` block — both of those are wrong guesses that fail to
parse ("Expected record, but received array" / "Invalid input") and silently disable
every permission rule in the file. Marketplace registration itself isn't stored here at
all — it lives outside the project, so don't try to declare it in this file.

**Caveats, confirmed by hand:**
- In the VS Code extension, a change to plugin state (enabling, updating) isn't always
  picked up by a session that's already running — including a *new* session/tab opened
  in an already-open window. **Run `/reload-plugins` in the chat** to fix this — it's a
  built-in command that reloads plugin state in place (confirmed: it reports something
  like `Reloaded: 2 plugins · 6 agents · 2 hooks`). Try this first; it's faster than a
  full window reload (Ctrl+Shift+P → "Developer: Reload Window"), which is the fallback
  if `/reload-plugins` alone doesn't fix it.
- `--scope project` writes `.claude/settings.json` into whatever directory was the
  current working directory when you ran the command — which may not be your actual VS
  Code workspace root if you have a monorepo-style nested folder open. Run it from the
  exact folder you want it to apply to, or you'll get two separate `.claude/` dirs (one
  per folder) each independently "enabling" the plugin for that folder only.

## Updating

Installing from GitHub means everyone's copy is a local cache
(`~/.claude/plugins/cache/...`), not a live link to the repo — pushing changes doesn't
reach anyone automatically. After pushing an update, **every** installed copy (yours
included) needs this to actually pick it up:

**CLI:**
```
claude plugin marketplace update dp-agent-marketplace
claude plugin update dp-agent@dp-agent-marketplace --scope <user|project|local>
```
Check your actual scope first with `claude plugin list` if you're not sure — `update`
fails if you guess wrong (it defaults to assuming `user` scope).

**VS Code extension:** `/plugins` → Marketplaces tab → click the refresh icon next to
`dp-agent-marketplace`. Then run `/reload-plugins` in the chat.

**Either way, verify it actually worked** — don't just trust that the command
succeeded. Run `/dp-agent:dp-version` and check it matches what you just pushed (bump
`plugin.json`'s `version` field on every real change, specifically so this is
checkable). The "Base directory for this skill: ...\dp-agent\<version>\skills\..." line
any skill invocation prints is the same signal if you want a second confirmation. If it
still shows the old version after both commands above, try `/reload-plugins` again,
then a full window reload (Ctrl+Shift+P → "Developer: Reload Window") as a last resort.

## First-time setup

Copy `CLAUDE.md.example` to `CLAUDE.md` at your repo root and fill in every `TODO`. This
is what `/dp-plan` and `/dp-git-help` read for team convention — an unfilled section
means those skills will say "not specified" rather than guess, so it's worth actually
filling in before relying on them.

## The skills

Invoke these as `/dp-agent:dp-ticket`, `/dp-agent:dp-plan`, `/dp-agent:dp-cpr`,
`/dp-agent:dp-git-help` — Claude Code namespaces plugin skill commands as
`<plugin-name>:<skill-name>` to avoid collisions with other plugins, confirmed against
the real autocomplete (not just `/dp-ticket` etc., despite the directory names).

| Command | What it does |
|---|---|
| `/dp-agent:dp-ticket` | Scores a pasted ticket (or a ticket key, if a Jira MCP server is connected) against `templates/ticket-quality-bar.md`. Rewrites + drafts acceptance criteria if it falls short; classifies bug/feature/improvement if it passes. Works standalone — no dependency on the other three skills. |
| `/dp-agent:dp-plan` | Reads `CLAUDE.md` and explores the repo to ground a plan in real files (never guesses paths), writes a plan in the exact shape of `templates/plan-format.md`, and hands off to Claude Code's native plan mode (`EnterPlanMode`/`ExitPlanMode`) for approval. Writes nothing before approval — but once the plan is approved, it implements it directly in the same flow (see "Chained flow" below). |
| `/dp-agent:dp-cpr` | Reads the working diff and drafts a commit message (`templates/commit-message.md`) and PR description (`templates/pr-description.md`), links the originating ticket, and summarises test changes. Appends the `DP-Agent: v1` commit trailer so adoption can be tracked with `git log --grep`. Only drafts — it will not `git commit`/`push` without explicit confirmation. |
| `/dp-agent:dp-git-help` | Explains branch state vs. the remote in plain language (no git jargon). Up to date → confirms it's safe to push. Uncommitted changes → offers to commit with whatever `/dp-cpr` already drafted, or points to `/dp-cpr` if nothing's drafted yet. Behind → explains why and gives the exact pull/rebase command (checks `CLAUDE.md` for a stated preference first). Conflicted → names the conflicting files and explains each one, then **stops** — it never resolves a conflict; that's always the developer's call. |
| `/dp-agent:dp-version` | Prints the installed plugin version — one line, nothing else. Use this to confirm an update actually landed instead of trusting that the update command succeeded. |
| `/dp-agent:dp-review` | For a senior reviewer with only high-level project knowledge, checks whether a PR's diff (`gh pr view`/`gh pr diff`) stays within the scope of its originating ticket, using `templates/scope-review.md`. Classifies every changed file in-scope/questionable/out-of-scope with reasoning, and flags anything that's also high blast-radius per `templates/plan-format.md`'s categories. Not a correctness/quality review — offers to hand off to the separate `code-review` skill for that via the `Skill` tool, and only posts its summary as a PR comment on explicit confirmation. Input is a PR number/URL via `gh`, not a ticket — this is the reviewer's tool, not part of the author-side chain below. |

Each skill's frontmatter `description` is what drives auto-invocation — Claude may pick
one of these up on its own if the request matches (e.g. pasting a ticket). You can also
invoke them explicitly by name.

## Chained flow

The four skills can run as one guided pass instead of four separate manual invocations:

```
/dp-agent:dp-ticket  →  "proceed to plan?"        →  yes
/dp-agent:dp-plan    →  native plan-mode approval  →  implements the plan directly
                      →  AC checklist + test summary (✅/⚠️/❌ per criterion)
                      →  "proceed to commit/PR?"   →  yes
/dp-agent:dp-cpr     →  drafts, commits on your confirmation
                      →  "check git state now?"    →  yes
/dp-agent:dp-git-help
```

Each arrow is an explicit checkpoint (via `AskUserQuestion`), not a silent auto-chain —
decline at any point and that skill's output is the end of the run. This is a deliberate
choice: dp-agent's whole premise is developer control over consequential steps
(committing, implementing), so chaining adds convenience without removing the checkpoints
the plugin exists to enforce. If you want fully unattended chaining with no prompts,
that's a different, riskier mode this plugin doesn't currently offer on purpose.

One boundary worth knowing: the plan file that native plan mode writes to (its name,
location, and the "Accept this plan?" UI itself) is a Claude Code core feature, not
something a skill can restructure — `/dp-plan` writes into whatever plan mode gives it,
it can't offer a different review UI or storage format.

### Reviewer entry point: `/dp-agent:dp-review`

`/dp-agent:dp-review` is not a step in the chain above — it's for whoever is
*reviewing* the PR, not whoever wrote it, and it starts from a PR number/URL (via
`gh`), not a ticket. It runs standalone, on its own trigger:

```
/dp-agent:dp-review 42   (or a PR URL, or omitted to infer from the current branch)
  → scope verdict: contained | drifted
  → "hand off to /code-review for correctness/quality?"  →  yes  →  code-review (via Skill tool)
  → "post this scope summary as a PR comment?"           →  yes  →  gh pr comment
```

Same checkpoint discipline as the author-side chain above — each arrow is an
explicit `AskUserQuestion`, and posting to the PR only happens on confirmation,
never by default. `code-review` is a different plugin's skill; the handoff goes
through Claude Code's `Skill` tool by name, not a relative-path read the way
dp-agent's own skills chain into each other.

## Hooks

`hooks/hooks.json` registers two `PreToolUse` guardrails, both real blocks (exit code
`2`), not suggestions:

- **`protect-tests.sh`** — blocks `Edit`/`Write` on a test file that already exists on
  disk. Creating a *new* test file is always allowed. Tune `TEST_FILE_REGEX` at the top
  of the script if your test file conventions don't match the defaults (`__tests__/`,
  `tests/`, `spec/`, `*.test.*`, `*.spec.*`, `test_*`/`*_test`, `*Test.*`/`*Spec.*`).
- **`block-secrets.sh`** — blocks `Read` of `.env`, `*.pem`, and anything with
  `credentials` in the filename, so they never enter context. Add more patterns to the
  `case` block at the bottom of the script as your stack requires (SSH keys, `*.p12`,
  cloud service-account JSON, etc. — see the `TODO(team)` comment in the file).

Both scripts run under `bash` (invoked explicitly via `${CLAUDE_PLUGIN_ROOT}` in
`hooks.json`, so this works under Git Bash on Windows too — shebangs alone are ignored by
Windows). They use `jq` if it's installed, and fall back to a `grep`/`sed` parse of the
hook's JSON stdin if it isn't — no hard dependency either way.

## Tuning the templates

This is the main lever for the whole plugin. Everything under `templates/` is meant to
be edited without touching any `SKILL.md`:

- `ticket-quality-bar.md` — what "good" means on each of the four scored axes, and the
  pass/fail thresholds.
- `acceptance-criteria.md` — the AC format `/dp-ticket` drafts in (Given/When/Then vs.
  checklist — pick one).
- `plan-format.md` — section headers are fixed (kept consistent across the team on
  purpose); the risk scale and blast-radius categories inside it are yours to define.
- `commit-message.md` / `pr-description.md` — your actual commit and PR conventions.
  Both are short by design (one-line commit body, short fields in the PR) — the one
  fixed line is the `DP-Agent: v1` trailer in `commit-message.md`, kept for adoption
  tracking.
- `branching.md` — branch naming (`<type>/<TICKET-KEY>-<short-title>`, read back by
  `/dp-cpr` to auto-link the ticket), the setup commands `/dp-ticket` offers once a
  ticket is ready, and the pull-vs-rebase table `/dp-git-help` follows.
- `scope-review.md` — how strict "in scope" is for `/dp-review`: what counts as a
  defensible drive-by (Questionable) vs. real scope creep (Out of scope), and
  whether generated files/test files outside the ticket's area get special
  treatment. Its Blast-radius section deliberately reuses `plan-format.md`'s
  categories rather than defining its own — edit blast radius in one place, not two.

If a `SKILL.md` ever contains more than a few sentences of team-specific wording, that's
a bug — it belongs in one of these files instead.

## License

MIT — see [LICENSE](./LICENSE).
