<!--
TODO(team): The section headers below are fixed by the dp-agent spec — keep
them so /dp-plan's output is consistent across the team. What's yours to
edit: the risk severity scale, the blast-radius categories, and the model
recommendation guidance, all marked TODO below.
-->

# Implementation Plan Format

Fill in every section. Do not skip a section — write "None identified" if empty.

```markdown
## Ticket
[key/title] — [link]

## Summary
One paragraph: what this plan achieves and why.

## Files to change
- `path/to/file.ext` — what changes and why (found by exploring the repo,
  not guessed)
- ...

## Steps
1. Ordered, each step small enough to review independently
2. ...

## Tests to add
- TODO(team): what's the minimum bar — unit only, or unit + integration?
  State the file(s) and what each new/changed test asserts.

## Risks
<!-- TODO(team): define your severity scale, e.g. Low/Medium/High with
     criteria for each, or a numeric scale. Placeholder below. -->
- [severity — TODO(team) scale] risk description — mitigation

## Blast radius
<!-- TODO(team): what categories matter here? e.g. "user-facing / internal
     API / data migration / infra" — placeholder categories below. -->
- Affected surface: TODO(team)
- Reversibility: TODO(team) — can this ship behind a flag / be rolled back
  cleanly?

## Model recommendation
[Model] — [one-line reason, e.g. file count, presence of schema/migration
changes, novelty of the pattern]. This is a suggestion for the developer,
not an instruction the plan executes on.
```
