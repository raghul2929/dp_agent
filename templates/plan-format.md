<!--
TODO(team): The section headers below are fixed by the dp-agent spec — keep
them so /dp-plan's output is consistent across the team. What's yours to
edit: the risk severity scale, the blast-radius categories, and the model
recommendation guidance, all marked TODO below.
-->

# Implementation Plan Format

Fill in every section. Do not skip a section — write "None identified" if empty.

**Keep it tight.** This is a plan, not a design doc — the developer should be able to
scan the whole thing in under a minute. Bullet points, not paragraphs. State *what*,
not *why*, unless the why is genuinely non-obvious (a workaround, a constraint that
isn't visible in the code). No section here should run longer than what's below shows —
if a section is running long, that's a sign the ticket needs splitting, not a sign to
write more.

```markdown
## Ticket
[key/title] — [link]

## Summary
One sentence — what this plan achieves. Not a restatement of the ticket, not a
paragraph.

## Files to change
- `path/to/file.ext` — one line: what changes (found by exploring the repo, not
  guessed)
- ...

## Steps
1. One line each, imperative, small enough to review independently
2. ...

## Tests to add
- One line per test: file + what it asserts. TODO(team): unit only, or unit +
  integration as the minimum bar?

## Risks
<!-- TODO(team): define your severity scale, e.g. Low/Medium/High with
     criteria for each, or a numeric scale. Placeholder below. -->
- [severity — TODO(team) scale] risk — mitigation, one line each

## Blast radius
<!-- TODO(team): what categories matter here? e.g. "user-facing / internal
     API / data migration / infra" — placeholder categories below. -->
- Affected surface: TODO(team)
- Reversibility: TODO(team) — can this ship behind a flag / be rolled back
  cleanly?

## Model recommendation
[Model] — one-line reason (file count, schema change present, novelty of the
pattern). To switch before implementation starts: `/model [name]`. A suggestion for
the developer to act on themselves — dp-plan does not switch models on its own.
```
