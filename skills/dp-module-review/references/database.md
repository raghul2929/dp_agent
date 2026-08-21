# Database pass

Run when layer is Database or All.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] A migration exists for every column the code reads or writes.
- [ ] Money stored as decimal or integer minor units, never float.
- [ ] Unique constraint wherever the code assumes uniqueness.
- [ ] Index for every new column used in `WHERE`, `JOIN`, or `ORDER BY`.
- [ ] `down` reverses without losing data.
- [ ] Parameterised queries only.
- [ ] Scoping predicate (tenant, company, active, soft-delete) applied consistently.
- [ ] Totals reconcile across stored, displayed, and exported values.

- [ ] A column type change via the query builder's `.alter()` preserves `NOT NULL`, `DEFAULT`, and scale - a bare alter silently drops them on several engines; verify against the live schema, not the migration source.
- [ ] Every `down()` drops foreign keys before the columns that carry them, and the batch's rollback order is checked end to end - a later migration's destructive `down()` can commit before an earlier one fails.
- [ ] An application-enforced uniqueness invariant ("one active X per period") has a matching DB constraint; check-then-insert without one is a race.
---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Schema

- [ ] A migration exists for every column, table, and index the code reads or writes.
- [ ] Types fit the real data. **Money is decimal or integer minor units, never float.**
- [ ] `NOT NULL` and defaults set deliberately; nullable columns handled in code.
- [ ] Unique constraints wherever the code assumes uniqueness - a check-then-insert in application code is not a constraint.
- [ ] Foreign keys with an explicit `ON DELETE` behaviour.
- [ ] Enum/status columns constrained, not free text.

## 2. Migrations

- [ ] `down` exists and actually reverses; no silent data loss.
- [ ] Safe on a large table - no blocking rewrite or long lock during deploy.
- [ ] Forward-compatible with the currently deployed code (deploy order stated: migrate then deploy, or the reverse).
- [ ] Backfill for existing rows, chunked rather than one giant update.
- [ ] Idempotent or guarded, so a re-run does not corrupt data.

## 3. Indexes and performance

- [ ] Index for every column used in `WHERE`, `JOIN`, or `ORDER BY` in the new queries.
- [ ] No N+1 - relations used in loops are eager-loaded.
- [ ] `SELECT` only the needed columns on wide tables.
- [ ] Pagination on any list that can grow; no unbounded result set.
- [ ] Aggregation done in the database, not by loading rows into memory.

## 4. Correctness of data access

- [ ] Parameterised queries - no string interpolation of user input.
- [ ] Scoping predicates applied consistently: tenant, company, branch, active, soft-delete. A missing one is both a bug and a data leak.
- [ ] Soft-deleted rows excluded from reports and exports where the rest of the app excludes them.
- [ ] Reads that must see committed data are not hitting a stale replica.

## 5. Transactions and integrity

- [ ] Multi-write operations wrapped in a transaction.
- [ ] No external calls (HTTP, mail, S3) inside a transaction holding locks.
- [ ] Concurrent updates to the same row handled - `SELECT ... FOR UPDATE` or an optimistic version column.
- [ ] Idempotency for anything retried: webhooks, jobs, double-submitted forms.
- [ ] Derived or cached values kept in sync with their source, or recomputed.
- [ ] Financial totals reconcile across every representation - stored value, displayed value, exported file. A rounding difference between two paths is a real defect, not a nit.

## 6. Sensitive data

- [ ] PII and financial columns encrypted at rest where the project does so elsewhere.
- [ ] Encrypted columns are not used in `WHERE` or `ORDER BY` in a way that defeats the encryption.
- [ ] Retention and deletion path exists for personal data.
- [ ] Backups and exports of these tables are access-controlled.
