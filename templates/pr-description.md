<!--
/dp-cpr fills this shape in verbatim. Every field is short — one line or a
short list, not a paragraph. Adjust below if the real convention drifts from
it; this file is the source of truth, not the example.

TODO(team): trimmed to 5 fields for now (Title/Ticket/Summary/Changes/AC).
Coupled, Testing, Not included, and Risk were in an earlier draft — add any of
them back here if the team wants that level of detail later; they're not
gone, just not required right now.
-->

# PR Description Format

```
Title:   [<TICKET-KEY>] <what this does>
Ticket:  <TICKET-KEY>
Summary: <what and why, one sentence — not a paragraph>
Changes: - <file/area> — <what changed>
         - <...>
AC:      - [ ] <acceptance criterion, checked off if this PR satisfies it>
```

Every field stays short — "Summary" is one sentence, "Changes" is one line per
file/area not per line of code. Nothing here should read like a paragraph. If a field
is running long, that's a sign to split the PR, not to write more here.

## Notes for /dp-cpr

- `Title` uses the same `[<TICKET-KEY>]` convention as the commit subject —
  TODO(team): confirm whether your Jira/GitHub integration requires an exact keyword
  like "Closes TICKET-123" somewhere in the description to auto-link/auto-transition,
  and where that keyword should go if so.
- `AC` comes from the ticket's acceptance criteria (from `/dp-ticket`'s draft, or
  `/dp-plan`'s AC checklist if that ran first) — check off what this PR actually covers,
  don't check off ones it doesn't.
- TODO(team): draft vs. ready-for-review default — should /dp-cpr always open as draft?
- TODO(team): does this differ if you squash-merge (i.e. does the PR description become
  the permanent record instead of the commit history)?
