<!--
TODO(team): This is the shape /dp-ticket uses when it drafts acceptance
criteria for a ticket that failed the quality bar. Pick ONE style below (or
replace both with your own) and delete the other.
-->

# Acceptance Criteria Format

**Keep each criterion to one line.** If a scenario needs more than a sentence to state,
it's probably two criteria, not one long one — split it rather than writing a paragraph.
Don't restate the ticket's description as a criterion; every line here should be
something a reviewer could check off, not context-setting prose.

## Option A — Given/When/Then

```
Given TODO(team): starting state / preconditions
When TODO(team): the action the user or system takes
Then TODO(team): the observable, testable outcome
```

Repeat one block per scenario. Always include:
- TODO(team): the happy path
- TODO(team): at least one negative/edge case convention — do you require
  error-state criteria on every ticket, or only when relevant?

## Option B — Checklist

```
- [ ] TODO(team): outcome, phrased as a testable statement
- [ ] TODO(team): outcome
- [ ] TODO(team): explicit "out of scope" line, if applicable
```

## Rules that apply regardless of style

<!-- TODO(team): confirm/replace these — currently placeholders -->
- TODO(team): should every AC line be independently verifiable by QA/reviewer
  without reading the code?
- TODO(team): how do you note criteria that depend on another ticket/system?
- TODO(team): required minimum number of criteria, if any?
