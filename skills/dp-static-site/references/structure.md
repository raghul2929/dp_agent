# Codebase structure

The shape below is the deliverable's skeleton. Pick the section for the chosen stack; the
principles at the bottom apply to all three.

## Vite + vanilla HTML/CSS/JS

```
src/
  components/         one folder per component: Card/Card.js + Card.css
  layouts/            base.html shell, section wrappers
  pages/              index.html, services.html, contact.html, 404.html
  styles/             tokens.css  base.css  utilities.css  main.css (imports, in order)
  data/               nav.json  services.json  footer.json
  scripts/            behaviour only — menu.js, tabs.js. No layout logic.
public/               images, fonts, favicon, robots.txt, sitemap.xml
index.html            Vite entry
vite.config.js        multi-page `build.rollupOptions.input`
```

HTML partials need a plugin — `vite-plugin-handlebars` or `posthtml-include`. Say which
you are adding and why before installing. Without one you will end up copy-pasting the
header into five files, which is the exact failure this skill exists to prevent.

## Next.js (App Router, static export)

```
app/
  layout.tsx          <html>, fonts, global metadata
  page.tsx            /
  services/page.tsx
  not-found.tsx
  sitemap.ts          generated from the route list
  robots.ts
components/
  ui/                 Button, Card, Badge, Input — pure, token-driven
  sections/           Hero, ServiceGrid, Testimonials — composed, data-driven
  layout/             Header, Footer, Container
lib/                  formatters, cn(), constants
data/                 typed content: services.ts, nav.ts
styles/               tokens.css, globals.css
public/
next.config.ts        output: 'export', images.unoptimized: true
```

Static-export constraints, all of which bite late if ignored: no route handlers, no
middleware, no server actions, no `next/image` optimisation (`unoptimized: true`), no
`dynamic = 'force-dynamic'`. `generateStaticParams` is required for every dynamic route.
Default to Server Components; add `'use client'` only on the leaf that needs interactivity.

Metadata comes from the `metadata` export per page, not hand-written `<head>` tags.

Two that fail the build or log warnings on current versions, and are pure boilerplate:

```ts
// app/sitemap.ts and app/robots.ts — these compile to route handlers, so under
// `output: 'export'` they need this or the build fails outright.
export const dynamic = 'force-static';
```

```ts
// themeColor, viewport, colorScheme belong to a `viewport` export, NOT `metadata` —
// leaving them in metadata warns once per page.
export const viewport: Viewport = { themeColor: '#000' };
```

Also set `trailingSlash: true` so routes emit `about/index.html` rather than `about.html`
— that form works on every static host without rewrite rules.

**Delete `app/globals.css` and `app/page.module.css` from the scaffold before writing any
CSS.** They carry opinionated defaults that will fight the mockup's own reset, and the
resulting specificity battle is much harder to debug than a blank slate.

## Astro

```
src/
  components/         .astro by default; framework components only where interactive
  layouts/Base.astro
  pages/              file-based routing, incl. 404.astro
  content/            content collections if the site has posts/services with schema
  styles/
public/
astro.config.mjs      site: 'https://…' — required for sitemap
```

Add `@astrojs/sitemap`. Ship zero JS unless a component needs it, then use the narrowest
`client:*` directive that works (`client:visible` over `client:load`).

## Principles for all three

**One component, one responsibility.** If you cannot name it in one noun, split it.

**Props in, markup out.** A component that reaches for global state, fetches, or knows
its own route is not reusable. Data comes from `data/` through the page.

**Content is data.** Nav items, service cards, testimonials, footer columns, FAQ entries,
pricing rows — every list the mockup hardcodes becomes an array in `data/`, rendered by a
map. This is the difference between a mockup with a build step and a codebase somebody
can maintain.

**Colocate styles.** Component CSS lives beside its component (CSS Modules, `.astro`
scoped styles, or a matching `Card.css`). Only tokens, base and the few real utilities are
global.

**Name consistently.** Components `PascalCase`, files matching the component, data files
`kebab-case.json`, CSS classes one scheme throughout (BEM or modules — pick one, in
`CLAUDE.md`).

**Config, not constants scattered.** Site name, domain, contact details, social links go
in one `site.config.ts`/`json`. They appear in metadata, JSON-LD, the footer and the
sitemap; three copies means two go stale.

**Ship the boring files:** `.editorconfig`, `.gitignore`, `.nvmrc`, `README.md` with real
run/build/deploy commands, `.env.example` if anything is configurable, and a Prettier +
ESLint (or Biome) config wired to `npm run lint`. A handover without a README is not a
handover.
