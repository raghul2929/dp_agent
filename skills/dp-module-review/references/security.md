# Security pass

Work every item. For each, either report a finding with `file:line` and a failure scenario, or record it as clean. Read the code path end to end - never infer a vulnerability from a name.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] Every mutating route (POST/PUT/PATCH/DELETE) has an auth check - diff the guarded list against the mutating list explicitly.
- [ ] Every `/:id` handler verifies the caller may access *that record*, not merely that they are logged in.
- [ ] No secrets in code, config, tests, fixtures - or in git history.
- [ ] User input never concatenated into SQL, a shell command, or a file path.
- [ ] User content escaped on output; no raw/unescaped rendering.
- [ ] CSRF enabled for cookie/session flows.
- [ ] No mass assignment of role, permission, price, or ownership fields.
- [ ] Uploads: type verified by content, size capped, stored outside the web root.
- [ ] Generated documents (PDF/CSV/XLSX) are written outside the web root - a static-file middleware registered ahead of routing serves them before any auth runs.
- [ ] Where a CSRF token *field* is rendered, verification is actually enabled - a framework that plants the token but skips the check leaves forms that look protected and are not.
- [ ] Export and reporting endpoints do not decrypt encrypted-at-rest columns on the way out, undoing field-level encryption at the boundary.
- [ ] A derived document password (name, DOB, employee code) is treated as no protection at all, and the cipher actually used is checked rather than assumed.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Authentication

- [ ] Every new route, endpoint, job, webhook, and socket handler has an auth check. Trace it, do not assume the router applies one.
- [ ] Mutating routes especially: `POST`/`PUT`/`PATCH`/`DELETE` are often left unguarded while the matching `GET` is guarded. Diff the guarded list against the mutating list explicitly.
- [ ] Session/token: expiry, rotation on login, invalidation on logout and password change.
- [ ] Password handling: hashed with bcrypt/argon2, never logged, never returned, no custom crypto.
- [ ] Password reset / OTP / magic link: single use, short expiry, rate limited, not guessable, does not leak whether an account exists.
- [ ] JWT: secret not shared with another purpose, algorithm pinned (no `none`, no `alg` from the token), expiry checked, signature verified.

## 2. Authorization - the highest-yield area

- [ ] Server-side enforcement exists. Hiding a button, an `if` in a template, or a nav filter is not authorization.
- [ ] **IDOR**: every `/:id` handler verifies the caller may access that specific record, not merely that they are logged in. Test mentally with another user's id.
- [ ] Role checks are centralised, not re-implemented per controller. Flag duplicated role logic - it drifts.
- [ ] Privilege escalation: can a user set their own role, flags, org, or price fields via mass assignment?
- [ ] Horizontal isolation in multi-tenant code: every query filtered by tenant/org/company id.
- [ ] Admin and export endpoints: exports, reports, bulk downloads, and impersonation are the classic forgotten ones.

## 3. Input handling

- [ ] Validation at the boundary with a schema/validator, not scattered `if` checks. Missing validation layer is a finding on its own.
- [ ] Mass assignment: `request.all()` / `req.body` passed straight into a model or `update()`. Allowlist fields.
- [ ] SQL injection: raw queries with interpolation. Parameterised or query-builder only.
- [ ] NoSQL / ORM injection: user-controlled operators or field names.
- [ ] Command injection: user data reaching `exec`, `spawn`, shell strings.
- [ ] Path traversal: user data in file paths, `../`, absolute paths, archive extraction.
- [ ] SSRF: user-supplied URLs fetched server-side; allowlist hosts, block internal ranges and metadata endpoints.
- [ ] Deserialisation of untrusted data, `eval`, dynamic `require`/`import` with user input.
- [ ] File upload: type verified by content not extension, size cap, stored outside the web root, filename sanitised, no execution.

## 4. Output and web surface

- [ ] XSS: unescaped output, `innerHTML`, `v-html`, `dangerouslySetInnerHTML`, safe/raw template filters, user data in inline `<script>`.
- [ ] CSRF: enabled for cookie/session flows. If disabled, that is Critical unless the app is purely token-auth. Check the config, do not assume the framework default.
- [ ] CORS: no wildcard origin with credentials; origin allowlist not reflected from the request.
- [ ] Cookies: `httpOnly`, `secure`, `sameSite` set on session cookies.
- [ ] Security headers: CSP, `X-Content-Type-Options`, frame options, HSTS.
- [ ] Open redirect: user-supplied `next`/`redirect` parameters.

## 5. Secrets and sensitive data

- [ ] No credentials, keys, tokens, or connection strings in code, config, tests, fixtures, seeds, or comments.
- [ ] `.env` gitignored; `.env.example` updated with placeholders only.
- [ ] New env vars validated at startup, not on first use. Lazy failure hides misconfiguration until production.
- [ ] Sensitive fields (salary, bank, ID numbers, health, PII) encrypted at rest where the project already does so; check the new module follows the same path.
- [ ] Data not leaking through: logs, stack traces returned to the client, verbose error responses, over-fetched API payloads, exports, or files written under a publicly served directory.
- [ ] Audit trail for sensitive actions: role change, payroll, deletion, export, impersonation.

## 6. Dependencies and supply chain

- [ ] Lockfile committed. New dependencies justified, maintained, and not typosquats.
- [ ] Known CVEs from the audit triaged - reachable or not, and say which.
- [ ] No install-time scripts from unfamiliar packages; no git/tarball URL dependencies.

## 7. Abuse and availability

- [ ] Rate limiting on login, OTP, search, export, and anything expensive.
- [ ] Unbounded queries or downloads (no pagination, no row cap) usable as a DoS.
- [ ] Regex on user input that can backtrack catastrophically.
- [ ] Cost-bearing operations (mail, SMS, third-party API) triggerable by an unauthenticated caller.

## Severity guidance

- **Critical** - unauthenticated access to data or actions, RCE, SQLi, secret in the repo, auth bypass.
- **High** - IDOR behind login, CSRF disabled with cookie auth, privilege escalation, PII in logs.
- **Medium** - missing rate limit, weak validation with limited impact, missing security header.
- **Low** - defence-in-depth improvements with no current exploit path.
