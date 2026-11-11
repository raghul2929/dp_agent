# Security for a static site

A static site has a small attack surface, which is exactly why the few real risks get
skipped. All of the below is cheap.

## 1. Nothing secret in the bundle

Everything shipped is public: source, comments, sourcemaps, `.env` values inlined at build
time, and any file in `public/`.

- Vite exposes only `VITE_*`; Next only `NEXT_PUBLIC_*`. **That prefix is a publication
  decision, not a config detail** — never put a real key behind it.
- Grep the built output before reporting: `api[_-]?key`, `secret`, `token`, `password`,
  `Bearer `, `-----BEGIN`, plus `localhost` and internal hostnames.
- Third-party form and analytics IDs are usually fine to expose; API keys with write
  scope never are. If the mockup contains one, treat it as leaked, say so, and tell the
  user to rotate it.
- Do not ship production sourcemaps unless the user asks.

## 2. Response headers

Set them on the host. Per target:

**Netlify** — `netlify.toml`:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    X-Content-Type-Options  = "nosniff"
    Referrer-Policy         = "strict-origin-when-cross-origin"
    Permissions-Policy      = "camera=(), microphone=(), geolocation=()"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains"
```

**Vercel** — the `headers` array in `vercel.json`. **Cloudflare Pages** — a `_headers`
file. **GitHub Pages / plain bucket** — headers cannot be set; fall back to
`<meta http-equiv="Content-Security-Policy">` (which cannot express `frame-ancestors` or
HSTS) and say plainly in the report that the protection is partial.

Build the CSP from what the site actually loads, then verify with the browser console
open — a CSP that blocks your own fonts is worse than none, because the next person
deletes it entirely. `'unsafe-inline'` for styles is usually unavoidable with inline
critical CSS; `'unsafe-inline'` for **scripts** is not — hash or externalise instead.

## 3. Links and embeds

- `rel="noopener noreferrer"` on every `target="_blank"` (grep for it).
- `sandbox` and an explicit `allow` on every `<iframe>`; never embed a user-supplied URL.
- Any surviving CDN `<script>` needs `integrity` + `crossorigin`. Better: Step 4 should
  have removed it.

## 4. Client-side script hygiene

- `textContent` over `innerHTML`. If `innerHTML` is genuinely needed, the input must be
  a literal in your own code — never a query param, hash, or `localStorage` value.
- Never `eval`, `new Function`, or `setTimeout("string")`.
- Query params are attacker-controlled. Reading `?next=` and assigning it to
  `location.href` is an open redirect; allowlist paths instead.
- `localStorage` is readable by any script on the origin — UI preferences only.

## 5. Forms

Static sites have no backend, so the form provider is the security boundary.

- Use a real provider (Netlify Forms, Formspree, a serverless function). Never post to a
  URL that does not exist, and never fake a success state.
- Validate client-side for UX, and rely on the provider for the real check.
- Spam: honeypot field plus the provider's captcha. Do not roll your own.
- Never collect passwords, card numbers, or government IDs on a static site.
- The success redirect must be a same-origin relative path.
- Say what data the form sends and to whom — that is a privacy-policy obligation, and the
  user needs to know before launch.

## 6. Dependencies

- `npm audit` after install; report what it says.
- Lockfile committed.
- Prefer few, well-known packages. A copy-pasted carousel from a random gist is a supply
  chain decision.
- Pin the Node version in `.nvmrc`.

## 7. Report honestly

State which headers are actually enforced on the chosen host, whether the CSP was tested
with the console open, and anything you could not verify. "Security: hardened" with no
detail is not a finding — the checklist with results is.
