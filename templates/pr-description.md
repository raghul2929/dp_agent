<!--
/dp-cpr fills this shape in verbatim, as real markdown content (headings, bold,
bullets — never a flat key:value text block). When presenting the draft in chat,
wrap the whole thing in a single fenced code block so copy-paste preserves the raw
syntax — copying rendered chat output strips `##`/`**`/`- [ ]` characters, which
defeats the point once it's pasted into GitHub. Every field is short — one line or a
short list, not a paragraph. Adjust below if the real convention drifts from it; this
file is the source of truth, not the example.

TODO(team): 7 fields now (Title/Ticket/Migration/Deployment/Summary/Changes/AC).
Coupled, Testing, Not included, and Risk were in an earlier draft — add any of
them back here if the team wants that level of detail later; they're not
gone, just not required right now.
-->

# PR Description Format

```markdown
## [<TICKET-KEY>] <what this does>

**Ticket:** <TICKET-KEY>
**Migration:** <Yes — one line on what / No>
**Deployment:** <Yes — one line on what / No>

### Summary
<what and why, one sentence — not a paragraph>

### Changes
- <file/area> — <what changed>
- <...>

### Acceptance Criteria
- [ ] <acceptance criterion, checked off if this PR satisfies it>
```

Every field stays short — "Summary" is one sentence, "Changes" is one line per
file/area not per line of code, "Migration"/"Deployment" are one line each ("No" is a
complete answer). Nothing here should read like a paragraph. If a field is running
long, that's a sign to split the PR, not to write more here.

## Notes for /dp-cpr

- The content must be real markdown (headings, bold, bullets) — never a flat
  key:value text block. But deliver it in chat inside a single fenced code block —
  that's a copy-paste wrapper for this chat response, not a statement about how
  GitHub should display it; GitHub renders the markdown normally once pasted.
- `Title` uses the same `[<TICKET-KEY>]` convention as the commit subject —
  TODO(team): confirm whether your Jira/GitHub integration requires an exact keyword
  like "Closes TICKET-123" somewhere in the description to auto-link/auto-transition,
  and where that keyword should go if so.
- `Migration`/`Deployment` default to "No" — only mark "Yes" if the diff actually
  touches migration/seed-script paths or deploy/infra config; don't guess "No" without
  checking the diff for those paths first.
- `AC` comes from the ticket's acceptance criteria (from `/dp-ticket`'s draft, or
  `/dp-plan`'s AC checklist if that ran first) — check off what this PR actually covers,
  don't check off ones it doesn't.
- TODO(team): draft vs. ready-for-review default — should /dp-cpr always open as draft?
- TODO(team): does this differ if you squash-merge (i.e. does the PR description become
  the permanent record instead of the commit history)?
