# dp-agent

A Claude Code plugin that standardises the path from a Jira ticket to a draft merge
request: ticket quality check → implementation plan → commit/PR drafting → git-state
help. **This is not a coding agent** — Claude Code already is one. This is skills,
templates, and hooks on top of it so the workflow is repeatable across a team instead of
depending on each developer's personal prompting habits.

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

**CLI**, quick local test, no marketplace needed:

```
claude --plugin-dir ./dp-agent
```

**VS Code extension** (the `--plugin-dir` flag is CLI-only, so this needs the
marketplace route instead — `.claude-plugin/marketplace.json` in this plugin already
declares itself as a self-hosted, single-plugin marketplace):

1. In the extension's chat box, type `/plugins`.
2. Go to the **Marketplaces** tab → add local path → point it at this plugin's folder,
   e.g. `D:\work_space\learnings\Ai_agent_dp\dp-agent`.
3. Go to the **Plugins** tab → find `dp-agent` → toggle it on.

Equivalent via chat commands, either front-end:

```
/plugin marketplace add D:\work_space\learnings\Ai_agent_dp\dp-agent
/plugin install dp-agent@dp-agent-marketplace
```

**Team-wide, so nobody has to do this by hand per project**: the reliable way to produce
this file is to let Claude Code write it itself rather than hand-editing — run this once
from the project root (needs the marketplace already added once via `/plugins` →
Marketplaces → Add, or `claude plugin marketplace add <path-to-dp-agent>`):

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
- In the VS Code extension, a change to this file is only picked up on a full window
  reload (Ctrl+Shift+P → "Developer: Reload Window"), not when merely starting a new
  Claude Code session in an already-open window.
- `--scope project` writes `.claude/settings.json` into whatever directory was the
  current working directory when you ran the command — which may not be your actual VS
  Code workspace root if you have a monorepo-style nested folder open. Run it from the
  exact folder you want it to apply to, or you'll get two separate `.claude/` dirs (one
  per folder) each independently "enabling" the plugin for that folder only.

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
| `/dp-agent:dp-git-help` | Explains branch state vs. the remote. Up to date → confirms it's safe to push. Behind → explains why and gives the exact pull/rebase command (checks `CLAUDE.md` for a stated preference first). Conflicted → names the conflicting files and explains each one, then **stops** — it never resolves a conflict; that's always the developer's call. |

Each skill's frontmatter `description` is what drives auto-invocation — Claude may pick
one of these up on its own if the request matches (e.g. pasting a ticket). You can also
invoke them explicitly by name.

## Chained flow

The four skills can run as one guided pass instead of four separate manual invocations:

```
/dp-agent:dp-ticket  →  "proceed to plan?"       →  yes
/dp-agent:dp-plan    →  native plan-mode approval →  implements the plan directly
                      →  "proceed to commit/PR?"  →  yes
/dp-agent:dp-cpr     →  drafts, commits on your confirmation
                      →  "check git state now?"   →  yes
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
  Everything is a `TODO(team)` placeholder until you fill it in; the one fixed line is
  the `DP-Agent: v1` trailer in `commit-message.md`, kept for adoption tracking.

If a `SKILL.md` ever contains more than a few sentences of team-specific wording, that's
a bug — it belongs in one of these files instead.
