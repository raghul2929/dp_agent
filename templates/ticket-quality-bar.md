<!--
TODO(team): This is the rubric /dp-ticket scores every ticket against.
Fill in what "good" and "bad" actually mean for each axis below. Keep the
four-axis structure and the 1-5 scale (dp-ticket's scoring logic depends on
both) — everything else here is yours to rewrite.
-->

# Ticket Quality Bar

Score the ticket 1-5 on each axis below, then compute the overall verdict.

## Axes

### 1. Title
- 5: TODO(team) — e.g. "Verb-first, states the user-visible outcome, no ticket-number-as-title"
- 3: TODO(team) — describe what a borderline title looks like
- 1: TODO(team) — describe what an unacceptable title looks like

### 2. Description
- 5: TODO(team) — e.g. "States the problem, the desired outcome, and any known constraints. A stranger could pick this up."
- 3: TODO(team)
- 1: TODO(team) — e.g. "One sentence, no context, assumes tribal knowledge"

### 3. Acceptance Criteria
- 5: TODO(team) — e.g. "Testable, enumerable, covers edge cases and the negative path"
- 3: TODO(team)
- 1: TODO(team) — e.g. "Missing entirely, or restates the title"

### 4. Ambiguity
- 5: TODO(team) — e.g. "No open questions; scope boundary is explicit (what's OUT of scope is stated)"
- 3: TODO(team)
- 1: TODO(team) — e.g. "Multiple plausible interpretations of what 'done' means"

## Verdict thresholds

<!-- TODO(team): tune these. Placeholder logic: -->
- All axes >= 4: **Ready for /dp-plan as-is.**
- Any axis <= 3: **Needs rewrite** — /dp-ticket produces a rewritten version and draft AC.
- Any axis == 1: **Needs a conversation with the reporter**, not just a rewrite — flag this explicitly instead of guessing intent.

## Ticket classification

<!-- TODO(team): adjust these definitions/keywords to match how your Jira project actually uses these types. -->
- **Bug**: TODO(team) — defines regression vs. existing-behavior-working-as-designed
- **Feature**: TODO(team)
- **Improvement**: TODO(team) — where's the line between this and a feature?
