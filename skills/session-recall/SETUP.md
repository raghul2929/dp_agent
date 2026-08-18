# Setting up session-recall

Two files, three hook entries, and Node 18+. Nothing to install, no npm dependency, no server,
no database.

There are two ways to run this. **Installing the plugin is the normal path** — it carries the
skill, the hooks and the other dp-agent skills together, and updates arrive with the plugin.
The standalone copy exists for a single repo that does not want the rest of dp-agent.

Do not run both at once for the same project. Both register `SessionStart`, `UserPromptSubmit`
and `SessionEnd`, so every prompt would be matched twice and every session digested twice. If
you are moving from standalone to plugin, delete the local copy and its settings block in the
same change — see *Switching from standalone to plugin* at the end.

---

## 1. Install as a plugin (recommended)

Add the marketplace once, then install:

    /plugin marketplace add https://github.com/raghul2929/dp_agent
    /plugin install dp-agent

Restart the session, or run `/reload-plugins` (CLI only — the VSCode extension has
`/reload-skills` but not `/reload-plugins` yet).

That is the whole setup. The plugin ships `hooks/hooks.json`, so all three hooks are registered
for every project where the plugin is enabled, resolved through `${CLAUDE_PLUGIN_ROOT}`:

| Hook | Command | Timeout |
| --- | --- | --- |
| `SessionStart` | `recall.mjs index 12 --dir "${CLAUDE_PROJECT_DIR}" --stdin --quiet` | 20s |
| `UserPromptSubmit` | `recall.mjs hook --dir "${CLAUDE_PROJECT_DIR}" --quiet` | 10s |
| `SessionEnd` | `recall.mjs digest --stdin --quiet` | 120s |

Confirm it took with `/dp-agent:dp-version`.

Then fill in the history you already have — without this, only sessions from today forward are
findable:

    node "<plugin-root>/skills/session-recall/recall.mjs" digest --backfill --dir "<your project>"

One `claude -p --model haiku` call per session of 4+ turns, about 20 seconds each, with a
one-second gap. Sessions shorter than that are skipped. It is safe to re-run: a session whose
card is current is skipped without a model call.

---

## 2. Standalone in one repo

Use this when you want recall in a single project without the rest of dp-agent.

### 2.1 Copy the skill

    <your repo>/.claude/skills/session-recall/
        SKILL.md
        recall.mjs

`DESIGN-REVIEW.md` and this file are documentation — copy them or don't.

The `SKILL.md` in the plugin uses `$SKILL_DIR` in its examples. Standalone, that path is just
`.claude/skills/session-recall`, and the two references to "this plugin's `hooks/hooks.json`"
mean your `.claude/settings.local.json` instead.

### 2.2 Add the hooks

In `<your repo>/.claude/settings.local.json` (create it if absent), merging with any hooks
already there rather than replacing the block:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/session-recall/recall.mjs\" index 12 --dir \"${CLAUDE_PROJECT_DIR}\" --stdin --quiet",
          "timeout": 20 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/session-recall/recall.mjs\" hook --dir \"${CLAUDE_PROJECT_DIR}\" --quiet",
          "timeout": 10 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/session-recall/recall.mjs\" digest --stdin --quiet",
          "timeout": 120 }] }
    ]
  }
}
```

`settings.local.json` is per-developer and usually gitignored. To share the hooks with the team,
put the same block in a tracked `.claude/settings.json` instead.

### 2.3 Backfill

    node .claude/skills/session-recall/recall.mjs digest --backfill --dir "$PWD"

---

## What each hook does, and what it costs

- **`SessionStart`** — prints an index of recent sessions (dates, titles, turn counts, topic
  terms). No conversation content. Reads at most 30 transcripts, ~0.3s warm.
- **`UserPromptSubmit`** — scores the prompt against stored subjects and prints 0–3 pointers,
  or nothing. Silence is the default and by far the common case. Never makes a model call.
- **`SessionEnd`** — writes one summary card. This is the only hook that calls a model, once per
  session, after the session is over.

All three exit `0` on every failure, print nothing on failure, and never block a prompt or a
session exit. The current session is always excluded from its own results.

## Requirements and limits

- **Node 18+** on `PATH`. No npm packages, no `jq`.
- **The `claude` CLI** on `PATH` for cards. Without it, `digest` writes a fallback card from the
  title and frequent terms, marked `source: fallback`; `digest --upgrade` re-tries those later.
- Transcripts are read locally and never leave the machine. Only `text` blocks are ever read —
  `tool_use` / `tool_result` are excluded, so file dumps and `.env` values cannot enter context.
  Quoted text is scrubbed of anything key-shaped before it is shown or stored.
- Recall is per-machine. Transcripts live in `~/.claude/projects/` and are not in git, so a
  teammate on another laptop shares none of this. Cards in `~/.claude/recall/` are the same —
  local, and deliberately outside the folder Claude Code sweeps after 30 days.

## Switching from standalone to plugin

In one change, not two:

1. Install the plugin (section 1).
2. Delete `<repo>/.claude/skills/session-recall/`.
3. Remove the three hook entries from `.claude/settings.local.json`, leaving any other hooks.

If both are live at once, both fire: two startup indexes, two pointers per prompt, and two
digests per session end.

Cards and transcripts are untouched by the switch — they live under `~/.claude/`, keyed by
project folder, so a backfill done under the standalone copy is still there afterwards.
