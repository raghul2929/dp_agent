<!--
TODO(team): /dp-cpr fills this shape in verbatim. Do not let the skill
invent a commit convention — replace every TODO below with your actual
convention (Conventional Commits? Jira-key-prefixed? something else?).
-->

# Commit Message Format

```
TODO(team): subject line convention — e.g. "<type>(<scope>): <summary>" or
"<TICKET-KEY>: <summary>". State max length here too (common: 50-72 chars).

TODO(team): blank line rule, then body wrapping width (common: 72 chars).

TODO(team): body content requirements — what must the body explain that the
subject can't? (e.g. "why", not "what")

TODO(team): footer/trailer conventions — ticket links, breaking-change
markers, co-author lines, etc.

DP-Agent: v1
```

## Notes for /dp-cpr

- The `DP-Agent: v1` trailer above is fixed — always append it, so adoption
  can be measured later with `git log --grep`. Do not let the team
  convention section above remove it.
- TODO(team): do you squash-merge? If so, does the commit message on the
  feature branch even matter, or should /dp-cpr optimize for the PR
  description instead? State the answer here so the skill doesn't guess.
