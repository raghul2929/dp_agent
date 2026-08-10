<!--
TODO(team): This is the rubric /dp-review scores a PR's diff against, file by
file, against the originating ticket. Fill in how strict "in scope" should be
for your team below. The three-tier structure (in-scope / questionable /
out-of-scope), the Blast-radius reuse of plan-format.md, and the Output shape
are fixed by the dp-agent spec — keep them so /dp-review's output stays
consistent with /dp-plan's and across the team.
-->

# Scope Review Format

Classify **every file touched by the diff** into exactly one tier below, with a
one-line reason citing what in the ticket (or `CLAUDE.md`'s Architecture section)
does or doesn't justify the change. A label with no reason isn't useful — the reason
is the entire point of this report, not the label.

## Tiers

### In scope
The file is directly named, implied, or required by the ticket's description or
acceptance criteria — e.g. the endpoint the ticket asks for, its own test file, a
type/schema it depends on that had to change too.

TODO(team): does a file needed only to make the change compile or pass lint (e.g. a
barrel/index export, a DI registration) count as in-scope automatically, or does it
still need its own reasoning line every time?

### Questionable
Plausibly related but not clearly called for — e.g. a shared utility touched "while I
was in there", a drive-by fix to an adjacent bug, a refactor of a neighboring function
that wasn't broken. Don't downgrade this to Out of scope just because *a* plausible
story exists for it — the point of this tier is surfacing "this needs a second look,"
not clearing it.

TODO(team): where's the line for your team? Is a drive-by fix of an adjacent bug always
Questionable (should be its own PR/ticket), or acceptable if it's small and the PR
description explains why?

### Out of scope
No plausible connection to the ticket's stated scope or the architecture area it lives
in — a different feature/module entirely, unrelated formatting or dependency churn, a
rename/reorganization the ticket never asked for.

TODO(team): do generated files (lockfiles, snapshots, migrations) get an automatic pass
here regardless of size, or do they still need a reasoning line like everything else?

TODO(team): do test files outside the ticket's core area count as In scope (adding
coverage near code you touched is good practice) or Questionable (touching test surface
the ticket didn't ask about)? Pick one so /dp-review doesn't have to guess per PR.

## Blast radius

Don't redefine this here — reuse `plan-format.md`'s **Blast radius** section
(`Affected surface` / `Reversibility`). For every file classified Questionable or Out
of scope, additionally flag it if it also matches one of those categories being
high-traffic/shared (widely-imported module, config/infra touching more than this PR,
hard to roll back). That combination — out-of-scope *and* high blast radius — is what's
worth the reviewer's attention first, not out-of-scope alone.

## Output shape

```markdown
## Scope review — PR #<number>: <title>
Ticket: <TICKET-KEY> — <link, if available>

### In scope
- `path/to/file.ext` — <reason>

### Questionable
- `path/to/file.ext` — <reason>

### Out of scope
- `path/to/file.ext` — <reason>

### Blast radius flags
- `path/to/file.ext` — <why it's high-traffic/shared, per plan-format.md's categories>

Scope verdict: contained|drifted — <N> questionable, <N> out-of-scope, out of <N> files total
```

Omit a tier's block entirely if it has no files in it (don't print an empty "### Out of
scope" heading with nothing under it) — except when every file is In scope, in which
case say that as one line instead of three empty headers.
