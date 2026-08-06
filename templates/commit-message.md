<!--
/dp-cpr fills this shape in verbatim. Convention: Conventional Commits subject
+ a bulleted change list body. Adjust the example below if the real convention
drifts from it — this file is the source of truth, not the example itself.
-->

# Commit Message Format

```
<type>(<scope>): <summary, imperative mood, lowercase after the colon>

- <Specific change 1, one sentence, capitalized, ends with a period.>
- <Specific change 2 — one bullet per distinct area touched: controller,
  routes, services, frontend, tests, etc. — not one bullet per file.>
- <...>

DP-Agent: v1
```

`<type>`: `feat`, `fix`, `refactor`, `docs`, `test`, `chore` — same set as
Conventional Commits. `<scope>`: the feature/component area, kebab-case (e.g.
`innovation-register`), not a file path. No hard subject length cap — clarity
over brevity, but don't pad it.

## Example

```
feat(innovation-register): implement asynchronous idea generation with job tracking

- Refactor VsmController to start innovation generation and return job ID.
- Add methods for checking the status of innovation generation.
- Update routes to handle asynchronous generation requests and status polling.
- Enhance services to manage background job execution and error handling.
- Modify frontend API calls to support new asynchronous workflow.
- Update tests to cover new functionality and ensure proper job status handling.

DP-Agent: v1
```

## Notes for /dp-cpr

- The `DP-Agent: v1` trailer is fixed — always append it on its own line at
  the end, so adoption can be measured later with `git log --grep`.
- One bullet per area of change (controller/routes/services/frontend/tests),
  not one bullet per file touched — match the example's granularity.
- TODO(team): do you squash-merge? If so, does the commit message on the
  feature branch even matter, or should /dp-cpr optimize for the PR
  description instead? State the answer here so the skill doesn't guess.
