# Project context harvest

Run this before any review pass. A generic review produces generic findings; the noise complaint about AI code review is almost always this step missing. The goal is to review against **this codebase's rules**, not against best practice in the abstract.

Read these if present, and carry a short digest into every review agent's brief:

## 1. Declared rules

- `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `CONTRIBUTING.md`, `docs/adr/*`, `README.md`
- Lint/format config: `.eslintrc*`, `.prettierrc*`, `ruff.toml`, `.editorconfig`, `phpcs.xml`
- Typecheck strictness: `tsconfig.json`, `mypy.ini`
- CI definition: `.github/workflows/*`, `.gitlab-ci.yml` - **whatever CI already enforces, do not re-report as a finding**; report only what CI would miss.
- PR template and any checklist the team already uses.

## 2. Observed conventions

Infer from three or four existing, non-new files in the same layer:

- How are routes protected here? Which middleware, which naming?
- Where does validation live - a validator class, a schema file, inline?
- How are errors returned - exception, error object, flash message?
- How is authorization expressed - policy class, role constant, inline check?
- Response shape, pagination style, naming (camel vs snake), timezone handling, money representation.
- Test style and location, if tests exist.
- Logging style and logger used.

## 3. Domain rules

Skim models, migrations, and the module's own comments for rules the code assumes but does not enforce: statuses that must move in one direction, records that must not be deleted after approval, values that must reconcile, periods that must not overlap.

## 4. How this changes findings

- A deviation from an established project convention **is** a finding, even if the code is objectively fine - inconsistency costs the next maintainer.
- A generic best practice the project has deliberately rejected (documented in CLAUDE.md or an ADR) is **not** a finding. Do not relitigate settled decisions.
- If the project already has a utility for something the new code reimplements, name the existing utility with its path. "Reuse `app/Services/X.js:40`" beats "consider extracting a helper".
- If CI already blocks it, drop it. The review's value is what automation cannot catch.

## 5. Risk ranking

Not all files deserve equal attention. Rank the surface before reviewing and spend the budget accordingly:

**Highest risk** - auth and session, authorization and roles, payment/payroll/financial calculation, PII handling and encryption, file upload and download, raw SQL, anything reachable without login, migrations that touch existing data, cron and queue entry points, third-party webhooks.

**Medium** - CRUD handlers, business services, API serialisers, forms.

**Lowest** - static assets, styling, copy, config with no secrets, generated files.

State the ranking in the report so the reader knows where attention went.
