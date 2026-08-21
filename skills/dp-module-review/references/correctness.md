# Correctness and bugs pass

Hunt for code that is wrong, not code that is ugly. Every finding needs a concrete failure scenario: specific input or state produces a specific wrong outcome.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] Every import, route target, and referenced column actually exists.
- [ ] No missing `await` or floating promise on a write.
- [ ] Null, empty, and zero handled at each level of access.
- [ ] Money is not a float.
- [ ] Multi-step writes are in a transaction; partial failure rolls back.
- [ ] Retried or re-submitted operations are idempotent.
- [ ] No empty `catch`, and no catch that continues as if successful.
- [ ] Timezone: stored UTC, converted once, never mixed.
- [ ] A global error-handling middleware or wrapper rethrows what it does not handle - a `catch` that matches a few cases and returns silently turns every other exception into an empty success response.
- [ ] A document, export, or summary prints the *stored* total rather than re-deriving it by summing already-rounded components.
- [ ] Two related fields a user can edit independently (count and its complement, quantity and total) are reconciled server-side, not merely assumed consistent.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Broken outright

- [ ] References to functions, files, routes, controllers, models, or columns that do not exist. Verify each import and each route target resolves.
- [ ] Dead registrations: middleware/provider/service written but never wired up; route defined twice so the second is unreachable.
- [ ] Syntax/runtime errors the toolchain would catch - run the parser or typechecker over the surface.
- [ ] Copy-paste bugs: the pasted block still references the original variable, table, or field.
- [ ] Async: missing `await`, floating promises, `forEach` with an async callback, unhandled rejections, callback and promise mixed.

## 2. Logic

- [ ] Off-by-one, inclusive/exclusive boundaries, wrong comparison operator.
- [ ] Inverted conditions and negation mistakes, especially in permission and status checks.
- [ ] Loose vs strict equality where types differ (`'0' == 0`), stringly-typed ids compared to numbers.
- [ ] Truthiness traps: `0`, `''`, `false`, `NaN` treated as absent; `if (value)` where `value` can legitimately be `0`.
- [ ] Early return / missing `else` leaving a variable unset on one path.
- [ ] Switch fallthrough, missing default branch.

## 3. Edge cases

- [ ] Empty collection, single element, very large collection.
- [ ] `null` / `undefined` / missing key at every level of a nested access.
- [ ] Zero, negative, and maximum values in numeric logic.
- [ ] Division by zero; float rounding in money calculations - money should be integer minor units or a decimal type, never a float.
- [ ] Duplicate input, out-of-order input, partially complete records.
- [ ] First run / empty database / no configuration present.

## 4. Dates, time, locale

- [ ] Timezone: stored UTC, rendered local, converted once. Mixed naive and aware values.
- [ ] DST transitions, month-end arithmetic, leap years.
- [ ] Multiple date libraries used inconsistently in the same flow.
- [ ] Date comparisons across string and object types.
- [ ] Cron and scheduled jobs: what happens on a missed run, an overlapping run, or a server restart mid-run.

## 5. State and concurrency

- [ ] Race conditions: read-modify-write without a lock or atomic update; two requests both passing the same check.
- [ ] Idempotency: double submit, retried webhook, re-run job, browser back-and-resubmit. Does it duplicate rows or double-charge?
- [ ] Transaction boundaries: multi-step writes not wrapped; partial failure leaves inconsistent state.
- [ ] Rollback path: if step 3 fails, are steps 1 and 2 undone?
- [ ] Shared mutable module-level state in a multi-request process.

## 6. Error handling

- [ ] Swallowed errors: empty `catch`, `catch` that only logs and continues as if successful.
- [ ] Errors caught too broadly, hiding a different failure.
- [ ] Failure of an external dependency (DB, S3, mail, third-party API) - is it handled, with a timeout and a bounded retry?
- [ ] Retry without backoff, or retry on a non-idempotent operation.
- [ ] Error message exposes internals to the user; or is so generic the operator cannot debug it.
- [ ] Resource cleanup on the error path: connections, file handles, streams, temp files, locks.

## 7. Resource leaks

- [ ] Unclosed DB connections, file handles, streams.
- [ ] Listeners added and never removed; timers/intervals stacking on repeat calls.
- [ ] Unbounded in-memory caches, arrays, or maps that only grow.
- [ ] Large files read fully into memory instead of streamed.

## 8. Integration correctness

- [ ] Does the new code match the contract of what it calls - argument order, units, nullability, return shape?
- [ ] Does it match the contract of what calls it - did a signature or response shape change while a caller was not updated?
- [ ] Assumptions about the data that the schema does not enforce.
