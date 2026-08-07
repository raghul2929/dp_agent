<!--
/dp-cpr fills this shape in verbatim. Short subject + a short body — this is
deliberately terser than a changelog. Adjust below if the real convention
drifts from it — this file is the source of truth, not the example.
-->

# Commit Message Format

```
<type>(<scope>): <what changed> [<TICKET-KEY>]

<why it was needed> · <what changed> · <what you left alone>

DP-Agent: v1
```

`<type>`: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. `<scope>`: the
feature/component area, kebab-case, not a file path. Body is **one line**, three short
clauses separated by `·` — not a bulleted changelog. If it doesn't fit in one line,
it's two commits, not a longer message.

## Example

```
feat(auth): add OTP login flow [PROJ-123]

Password-only login was blocked by security review · added OTP request/verify
endpoints and the login-form step · left the password path in place behind a flag

DP-Agent: v1
```

## Notes for /dp-cpr

- The `DP-Agent: v1` trailer is fixed — always append it on its own line at the end,
  so adoption can be measured later with `git log --grep`.
- Keep the body to one line. Resist the urge to enumerate every file — that's what the
  PR description's "Changes" section is for, not the commit message.
- TODO(team): do you squash-merge? If so, does the commit message on the feature
  branch even matter, or should /dp-cpr optimize for the PR description instead? State
  the answer here so the skill doesn't guess.
