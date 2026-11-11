# SEO, robots and structured data

Every URL below needs the production domain. If the user does not have one yet, use
`TODO_DOMAIN` verbatim, list it as a blocker, and never invent a plausible domain — a
wrong canonical or sitemap URL is worse than an obviously missing one.

## robots.txt

`public/robots.txt` for a normal public site:

```
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

Rules:

- **Never ship `Disallow: /`.** It is the single most common way a launch loses all its
  traffic, and it usually arrives copy-pasted from a staging config.
- `robots.txt` is not access control — it is a request. Anything genuinely private does
  not belong in a static bundle at all.
- Disallow only real noise: `/thanks`, `/preview`, `/*?utm_*` style params if the host
  generates them.
- The `Sitemap:` line must be an absolute URL.
- If the site is deployed to a staging host as well, that host needs its own blocking
  robots file — say so; do not solve it by blocking production.

Next.js: prefer `app/robots.ts`. Astro: `public/robots.txt`, or generate it in the
integration so the `site` config stays the single source of truth.

## sitemap.xml

Generate from the route list — never hand-maintain.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-09-02</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

Include only canonical, indexable, 200-returning URLs. Exclude the 404 and `/thanks`.
One URL per page — pick trailing-slash or not and be consistent with what the host
actually serves, since a mismatch produces a redirect on every sitemap entry.

## Per-page metadata

Required on every page, unique per page:

| Tag | Note |
|---|---|
| `<title>` | 50–60 chars. Page-specific first, brand last: `Payroll Software — Acme` |
| `<meta name="description">` | 140–160 chars, written for a human, unique per page |
| `<link rel="canonical">` | Absolute, self-referencing |
| `<html lang>` | Real language code |
| `<meta name="viewport">` | `width=device-width, initial-scale=1` |
| `<meta name="theme-color">` | From `--color-primary` |

Open Graph + Twitter, needed for any link that gets shared:

```html
<meta property="og:type"        content="website">
<meta property="og:url"         content="https://example.com/">
<meta property="og:title"       content="…">
<meta property="og:description" content="…">
<meta property="og:image"       content="https://example.com/og.png">  <!-- 1200×630, absolute -->
<meta property="og:site_name"   content="Acme">
<meta name="twitter:card"       content="summary_large_image">
```

`og:image` must be an absolute URL and must actually exist. If the mockup has no share
image, generate a simple token-styled one or list it as a blocker — a broken preview is
visible to everyone who shares the link.

## JSON-LD for a service business

One `Organization` (or `LocalBusiness`) block sitewide, plus a `Service` block per service
page and `BreadcrumbList` on deep pages. Emit as `<script type="application/ld+json">`.

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Acme Payroll",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "description": "…",
  "address": { "@type": "PostalAddress", "addressLocality": "…", "addressCountry": "IN" },
  "contactPoint": {
    "@type": "ContactPoint", "telephone": "+91-…", "contactType": "customer service"
  },
  "sameAs": ["https://www.linkedin.com/company/…"]
}
```

Use `LocalBusiness` instead when there is a physical address and opening hours; add
`FAQPage` when the mockup has a real FAQ section. Only mark up content that is visibly on
the page — invented review or rating markup is a manual-action risk, not a clever trick.

Pull every value from `site.config`, so metadata, JSON-LD, footer and sitemap cannot
disagree.

## The rest of the head

- Favicon set: `favicon.ico`, `icon.svg`, `apple-touch-icon.png` (180×180),
  `manifest.webmanifest` with name, theme colour and icons.
- `<link rel="preconnect">` only for origins actually used; self-hosted fonts need none.
- `<link rel="preload" as="font" crossorigin>` for the one or two woff2 files above the
  fold. Preloading everything is slower than preloading nothing.

## Checks before the report

- Every page has a unique title and description — grep and compare.
- Exactly one `<h1>` per page, no skipped heading levels.
- Every sitemap URL returns 200 in the preview build.
- `robots.txt` does not block anything you want indexed.
- JSON-LD parses (paste into a validator, or `JSON.parse` the block contents).
- No `noindex` left over from development.
