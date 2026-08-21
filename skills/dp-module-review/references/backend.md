# Backend and data pass

Run when layer is Backend or All. Complements security/correctness/gaps - focus here on the data and service layer.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] Response shape, status codes, and error format consistent with the rest of the app.
- [ ] Timeout set on every outbound call.
- [ ] Jobs and crons idempotent, overlap-protected, and their failures visible.
- [ ] Generated files and uploads access-controlled, not guessable URLs.
- [ ] New env vars documented and validated at startup, not on first use.
- [ ] Production defaults safe - no fallback credentials, no debug mode.
- [ ] No breaking change to an existing consumer's contract.
- [ ] Anything bypassing the project's normal data-access layer is flagged.

- [ ] Body-parser and query-string limits are set explicitly - framework defaults (payload size, `parameterLimit`) silently truncate large form posts rather than erroring, so a long table submits partially and reports success.
---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Data layer

Schema, migrations, indexes, queries, transactions and data integrity are covered by `database.md`. Run that pass instead of duplicating it here. Flag anything in this module that bypasses the project's normal data-access layer.

## 2. API design

- [ ] Consistent response shape, status codes, and error format with the rest of the app.
- [ ] Correct verbs and idempotency semantics: `PUT`/`DELETE` idempotent, `POST` protected against double submit.
- [ ] Versioning or additive-only changes for existing consumers.
- [ ] Pagination, filtering, and sorting parameters validated and bounded.
- [ ] Content type, encoding, and large-payload limits handled.
- [ ] Timeouts set on every outbound call; failures degrade rather than hang.

## 3. Background work

- [ ] Jobs and crons are idempotent and safe to re-run.
- [ ] Overlap protection - a slow run must not stack with the next tick.
- [ ] Failure visible: retries bounded, dead-letter or alert on permanent failure.
- [ ] Long-running work chunked; no unbounded batch that grows with the table.
- [ ] Timezone correctness for scheduled times.
- [ ] Startup-registered crons do not run on every process in a multi-process deploy.

## 4. Files and storage

- [ ] Uploads validated (type by content, size cap), stored outside the public web root unless intentionally public.
- [ ] Generated artefacts (PDFs, exports) are access-controlled, not guessable URLs.
- [ ] Temp files cleaned up on both success and failure.
- [ ] Storage target differs by environment in a way that is intentional and documented - check the condition is not inverted.
- [ ] Large files streamed, not buffered.

## 5. Config and environment

- [ ] New env vars in `.env.example`, documented, and validated at startup.
- [ ] Defaults safe for production (no permissive fallback credentials, no debug mode on).
- [ ] Behaviour identical across environments unless the difference is deliberate and stated.
- [ ] Secrets sourced from the environment or a secret manager, never from committed config.
