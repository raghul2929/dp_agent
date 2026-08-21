# Quality and tests pass

Quality findings must still be concrete. "This could be cleaner" is not a finding; "this 200-line method duplicates the role check in three other controllers, so a fix has to be made in four places" is.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] Test infrastructure exists, and the new code has tests.
- [ ] Negative auth tests exist: anonymous, wrong role, another user's id.
- [ ] The tests would fail if the code were broken.
- [ ] No debug output, commented-out code, or unreferenced TODOs.
- [ ] No duplicated permission or validation logic.
- [ ] No N+1 query and no unbounded result set.
- [ ] Logs carry no PII and no secrets.
- [ ] Migration reversible, and a rollback path is stated.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Tests - the harder half

- [ ] Does test infrastructure exist at all? No runner, no config, or a `test` script that cannot run is a High finding on a module going to main.
- [ ] Every acceptance criterion has a test.
- [ ] **Negative auth tests** exist: anonymous caller, wrong role, another user's record id. Most suites test only the happy path and miss exactly the bugs that matter.
- [ ] Edge cases from the correctness pass are covered: empty, null, zero, boundary, duplicate.
- [ ] Error paths tested, not just success.
- [ ] Integration tests touch the real query layer and the migrations, not only mocks.
- [ ] Tests assert on behaviour and values, not merely that nothing threw.
- [ ] Would the tests fail if the code were broken? Look for assertions that can never fail, over-mocking that stubs the thing under test, and snapshot tests that were regenerated to match a bug.
- [ ] Determinism: no dependence on real clock, timezone, network, random values, or test execution order.
- [ ] Fixtures contain no real customer data and no real credentials.
- [ ] Coverage on the new code specifically, not the repo average.

## 2. Structure

- [ ] Business logic in controllers/handlers that belongs in a service - flag when a controller exceeds a few hundred lines or performs calculations.
- [ ] Duplicated logic that should be shared, particularly permission checks, validation, formatting, and calculations. Say how many places it appears.
- [ ] Functions doing several unrelated things; deeply nested conditionals.
- [ ] Layering violations: view logic in the model, DB queries in the template, HTTP concerns in the service.
- [ ] Reinvented utilities that already exist in the codebase - search before flagging, then name the existing one with its path.

## 3. Readability and consistency

- [ ] Naming matches the domain and the surrounding code; no misleading names (a function called `get*` that writes).
- [ ] Magic numbers and stringly-typed constants that should be named or enums.
- [ ] Comments that explain **why**, and none that contradict the code.
- [ ] Formatting and idiom consistent with neighbouring files.
- [ ] Public interfaces documented where the project documents them.

## 4. Leftovers - delete before merge

- [ ] Debug output: `console.log`, `dd(`, `var_dump`, `debugger`, `print`.
- [ ] Commented-out code blocks.
- [ ] `TODO` / `FIXME` / `HACK` with no ticket reference.
- [ ] Unused imports, variables, functions, files, routes.
- [ ] Dependencies added but unused; dependencies used but not declared.
- [ ] Hardcoded localhost URLs, IPs, personal emails, test accounts.
- [ ] Vendored or generated directories committed by accident (`node_modules`, `dist`, `.DS_Store`, IDE folders).

## 5. Performance

- [ ] N+1 queries: a query inside a loop, or a lazy relation accessed per row.
- [ ] Queries with no index on the filtered or joined column - check the migration added one.
- [ ] Unbounded result sets: no pagination, no `LIMIT`, full-table export in a web request.
- [ ] Work in the request thread that should be queued: PDF generation, bulk mail, large exports, third-party calls.
- [ ] Repeated identical calls that should be cached or hoisted out of a loop.
- [ ] Payload size: whole objects returned where a few fields would do.

## 6. Observability

- [ ] Logging exists for the new failure modes, structured, with a correlation id, and **without PII or secrets**.
- [ ] Log levels sensible - not everything at `info`, not errors at `debug`.
- [ ] Metrics or alerts for anything that can fail silently, especially jobs and crons.
- [ ] Health of background work visible somewhere.

## 7. Release safety

- [ ] Migration reversible; `down` actually restores.
- [ ] Migration safe on a large table (no long lock), and forward-compatible with the currently deployed code.
- [ ] Backward compatibility for API consumers: no removed field, renamed key, or changed enum without a version or a migration path.
- [ ] Feature flag or kill switch for risky behaviour.
- [ ] Rollback plan if this misbehaves in production, and the blast radius if it does.
