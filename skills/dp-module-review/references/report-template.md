# Report template

Copy this structure. Delete sections that genuinely do not apply - but never delete the Coverage or Not Reviewed sections, those are the honesty guarantee.

---

# Review: <module> - <YYYY-MM-DD>

**Verdict: BLOCK | SHIP WITH FIXES | SHIP**
<one sentence of why>

| | |
|---|---|
| Scope | <module path> |
| Layer | Backend / Frontend / All |
| Depth | Quick / Standard / Deep |
| Surface | <N files, ~N lines> - diff against `<base>` / full module tree (no git history) |
| Licence policy | strict / permissive-family / report-only / none found - source: `<file>` |
| Reviewed by | Claude Code `/module-review` |

**Summary:** <2-4 sentences. What this module does, the overall state of it, and the one thing that most needs attention.>

Critical: N | High: N | Medium: N | Low: N

---

## Blockers - must fix before main

### 1. <One-line claim> `CONFIRMED`
**Severity:** Critical
**Where:** `path/to/file.js:120`
**Failure scenario:** <Specific: an anonymous user POSTs to /x with id=5 and the record is deleted.>
**Why it happens:** <the actual mechanism, referencing the code>
**Fix:** <the concrete change, with the code or the exact line to add>

### 2. ...

---

## Should fix

Same format, severity High / Medium.

---

## Nits

Terse list. `file:line` - what and why. No ceremony.

---

## Automated scan results

| Scan | Tool | Result |
|---|---|---|
| Build / typecheck | | |
| Lint | | |
| Tests | | |
| Secret scan | | |
| Dependency audit | | |
| Licence scan | | tool / metadata only |
| SAST | | |
| Built-in `security-review` | | ran / skipped - reason |
| Built-in `code-review` | | ran at level X / skipped - reason |

Record "not installed" or "not configured" honestly. A missing tool is itself a finding if the module is going to main.

### Licence inventory

Only when a policy exists or the job is licence-focused. Grouped by licence, never one row per package.

| Licence (SPDX) | Count | Scope | Policy result | Evidence |
|---|---|---|---|---|
| | | runtime / build / dev / vendored / asset | allow / exception / deny / unknown | metadata / LICENSE read |

List every `deny` and `unknown` entry individually with its dependency path. Exceptions used are named with their expiry.

---

## Coverage

Every dimension, every time. `Pass` / `Findings` / `N/A` / `Not checked`. Not-checked requires a reason.

| Dimension | Status | Note |
|---|---|---|
| Authentication | | |
| Authorization / IDOR | | |
| Input validation | | |
| Output / XSS / CSRF | | |
| Secrets and PII | | |
| Dependencies | | |
| Dependency licences | | |
| Abuse and rate limiting | | |
| Broken code / wiring | | |
| Logic and edge cases | | |
| Dates and timezone | | |
| Concurrency and idempotency | | |
| Error handling | | |
| Resource leaks | | |
| Integration gaps | | |
| Requirement coverage | | |
| Schema and migrations | | |
| Query performance | | |
| API compatibility | | |
| Background jobs | | |
| Config and environment | | |
| Tests | | |
| Structure and duplication | | |
| Leftovers and debug code | | |
| Observability | | |
| Release safety and rollback | | |
| Frontend states and forms | | |
| Accessibility | | |
| Open sweep (beyond checklist) | | |
| Completeness critic | | |

---

## Not reviewed

- <files or areas skipped, and why>
- <scans that could not run>
- <context unavailable - e.g. no git history, so secrets were checked in the snapshot only>

---

## Recommended next steps

1. <ordered, concrete>
2. ...
