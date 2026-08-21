# Integration gaps pass

Gaps are what is missing, not what is wrong. This pass catches "it was built but never connected" and "the requirement has no code". Absence is invisible in a diff, so hunt for it deliberately.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] New routes, middleware, services, and jobs are actually registered, not just written.
- [ ] A migration exists for every column the code reads or writes.
- [ ] Permissions created for new capabilities, and assigned to someone.
- [ ] Every stated requirement maps to code.
- [ ] Empty, error, permission-denied, and not-found states all exist.
- [ ] New config keys added to the example env file.
- [ ] Events emitted have registered listeners.
- [ ] The feature is reachable by a human - nav, menu, or linked route.

- [ ] A feature that is fully wired but hidden in the view (`display:none`, a commented-out link, no nav entry) - especially when it is the only path to an operation the workflow needs.
- [ ] Every workflow state has an exit as well as an entry; a state reachable only forward traps the record when a mistake is found late.
---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Wiring - built but not connected

For each new component, verify it is actually registered:

- [ ] Routes registered and reachable; route names/paths match what the UI or client calls.
- [ ] Controllers/handlers bound to those routes and the class actually exists.
- [ ] Middleware registered in the kernel/pipeline, not just written.
- [ ] Services/providers registered in the container.
- [ ] Models mapped to real tables; relationships declared on both sides.
- [ ] Migrations added for every new column the code reads or writes.
- [ ] Seeds/fixtures for reference data the module depends on (statuses, types, roles).
- [ ] Permissions/roles created for new capabilities, and assigned to someone.
- [ ] Navigation, menu, or dashboard entry so the feature is reachable by a human.
- [ ] Jobs/crons scheduled, queues bound, workers aware of the new job type.
- [ ] Events emitted have listeners; listeners registered.
- [ ] Config keys added to config files **and** to `.env.example`.
- [ ] Feature flag defined and defaulted safely.

## 2. Requirement coverage

- [ ] List every stated requirement or acceptance criterion. Map each to code and to a test. Anything unmapped is a gap.
- [ ] Anything in the module described in comments, TODOs, or docs but not implemented.
- [ ] Stub functions that return a hardcoded value, empty array, or `true`.

## 3. Missing paths in the flow

For every user-facing flow in the module, check all of these exist:

- [ ] Empty state - no records yet.
- [ ] Loading state and slow-response behaviour.
- [ ] Error state - what the user sees when it fails.
- [ ] Permission-denied state - not a crash, not a blank page.
- [ ] Not-found state for a bad or deleted id.
- [ ] Success confirmation and what happens next.
- [ ] Cancel / back / abandon halfway.
- [ ] Concurrent edit by two users.

## 4. Lifecycle gaps

- [ ] Create exists but update/delete does not, or delete leaves orphans.
- [ ] Soft delete vs hard delete inconsistent with the rest of the app; deleted records still visible in reports or exports.
- [ ] Cascade behaviour on parent deletion undefined.
- [ ] Status transitions: is every transition validated, or can a record jump from draft to approved?
- [ ] Reversal path for anything financial or irreversible (cancel, void, refund, re-run).

## 5. Cross-cutting gaps

- [ ] Does the new module honour the app's existing conventions for auth, logging, error format, pagination, response shape, and date handling? Divergence is a gap.
- [ ] Notification/email that the flow implies but does not send.
- [ ] Audit log entry for sensitive actions.
- [ ] Multi-tenant / multi-branch scoping applied like the rest of the app.
- [ ] i18n: hardcoded user-facing strings in a project that translates.
- [ ] Documentation: README, runbook, API docs, changelog entry.

## 6. Dependency gaps

- [ ] Environment or infrastructure the module needs that nobody provisioned: bucket, queue, index, cron entry, third-party account, webhook registration.
- [ ] Data backfill needed for existing rows so the feature works for them, not just for new records.
- [ ] Deploy ordering: does the code require the migration to have run first, or vice versa?

## Reporting gaps

State each gap as: what is missing, where it should have been, and what breaks because of it. A gap with no consequence is a note, not a finding.
