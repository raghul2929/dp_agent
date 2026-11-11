---
name: dp-static-site
description: Turn a finished HTML mockup into a real, production-shaped static website codebase — proper structure, reusable components, a design system extracted from the mockup, responsiveness, SEO (robots.txt / sitemap / metadata) and security headers. Asks where to build it, which stack (chosen live from what the mockup and today's ecosystem actually suggest, not a frozen list), and which site services are needed, then builds, runs, and pixel-diffs the built site against the original HTML until they match. Use whenever someone hands over an HTML/design file and wants it turned into a real site or front-end codebase.
argument-hint: "[path to the HTML mockup, or a folder of them]"
---

# /dp-static-site — HTML mockup → production static site, matched pixel for pixel

**The flow in one line:**
`ask (stack · styling · services · destination) → read mockup → extract tokens → scaffold → build components → SEO + security → screenshot-diff vs mockup until green → report`

This skill exists because the two hard parts of "make this HTML into a real site" pull
against each other. A clean codebase wants abstraction; a faithful UI wants the mockup's
exact pixels. Do them in the wrong order and you get a tidy codebase that looks nothing
like the design.

**So the order is fixed and non-negotiable:**

```
extract the design system FROM the mockup
  -> build components that consume only those tokens
    -> render, screenshot, diff against the mockup
      -> fix diffs until under threshold
        -> only then: SEO, security, a11y, polish
```

Never redesign. Never "improve" spacing, colour, or type while porting. If something in
the mockup looks wrong, port it faithfully and list it under **Deviations proposed** at
the end for the developer to decide. Your opinion about the design is not part of the
deliverable.

## Four rules that override everything below

1. **The mockup is the specification.** Any visual difference is a bug in your code, not
   a correction to the design.
2. **Extract, don't retype.** Every colour, font, radius, shadow and spacing value comes
   from reading the mockup's CSS — never from your memory of what "looks close".
3. **Prove the match.** A visual claim with no screenshot diff behind it is not a claim.
   Step 8 is not optional and its numbers go in the final report.
4. **Static means static.** No database, no server runtime, no auth, no secrets in the
   bundle. If the mockup implies a backend, stub it and say so.

---

## Step 0 — Cheap detection, before you ask anything

Thirty seconds of looking makes every question below accurate instead of generic:

- **Glance at the mockup** — file count, whether it already uses Tailwind classes or
  Bootstrap, whether it has media queries, how many distinct pages.
- **Look at the destination and the current directory** — is there already a
  `package.json`, a lockfile (which one — `package-lock` / `pnpm-lock` / `yarn.lock` /
  `bun.lockb`), a `CLAUDE.md`, an existing framework? If so, that repo's stack and package
  manager win; do not offer a choice that contradicts it, just confirm it in one line.
- **`node --version`** — a stack whose current release needs a newer Node than the machine
  has is not an option you should offer.

Anything you determine here is an answer you do not ask for. Say where you got it.

## Step 1 — Ask the questions

One **AskUserQuestion** call. Skip any question Step 0 or the user's own message already
answered, and state which answer came from where.

**1. Tech stack — derive the options, do not read them off a list**

The right answer changes with the mockup, the team, and the year. Build the option set at
runtime from three inputs, in priority order:

1. **The existing repo**, if there is one — matching it beats everything else.
2. **`CLAUDE.md`**, if it names a stack.
3. **The mockup's own shape** — page count, framework classes already present, how much
   interactivity the `<script>` blocks imply, whether there is a content model
   (blog/services/case studies) or just a handful of static pages.

Then sanity-check what "current" means today rather than trusting your training data:
**if a web search tool is available, check the current major version and status of EVERY
candidate you are about to offer — not just the one you are recommending.** Frameworks
change their static-export story, their router, and occasionally their recommended entry
point. Cite the version you offer (`Next.js 16, App Router`). If no search tool is
available, say plainly that versions are from training data and may be behind.

Checking only the favourite is the failure mode to avoid: the user picks the option you
did not check, and you build on a version that is one or two majors stale. If a check is
too slow to run for all three, do not print a version number next to the unchecked ones.

The stable candidates at time of writing — a **starting point to validate, not a menu to
recite**:

| Candidate | Fits when |
|---|---|
| **Vite + vanilla HTML/CSS/JS** | Few pages, no app state. Closest to the mockup, zero runtime deps, deploys to any bucket. **Default when nothing else points elsewhere.** |
| **Astro** | Content-heavy sites — services, blog, case studies. Ships zero JS by default, islands where needed. Usually the best fit for a service business. |
| **Next.js (App Router, `output: 'export'`)** | Team already runs React, or the site will grow app-like features later. Static export only — check `references/structure.md` for the constraints that fail the build. |
| **SvelteKit / Nuxt (static adapter)** | The team already works in Svelte or Vue. Offer only then. |
| **11ty / Hugo** | Large content site, or the team wants no Node runtime in the build at all. |

Offer **at most three** — the fitted ones — plus free text. Name the default and the
one-line reason so a user who does not care can just accept it. If you are recommending
against the stack the user named, say so once, then build what they asked for.

**2. Styling layer** — plain CSS with custom properties + a BEM-ish naming scheme, or
Tailwind. Plain CSS is the default: it maps one-to-one onto what the mockup already has,
which makes Step 8 converge much faster. Choose Tailwind only if the mockup was already
built with Tailwind classes (detect this — grep the mockup for `class="flex `,
`text-sm`, `md:` prefixes) or the user asks.

**3. Site services** — multi-select, because these are exactly what gets forgotten and
then retrofitted badly:

- `robots.txt` + `sitemap.xml`
- SEO metadata: title/description per page, canonical, Open Graph, Twitter card
- Structured data (JSON-LD) — Organization / LocalBusiness / Service, since these are
  service-business sites more often than not
- Favicon + web app manifest + touch icons
- Analytics hook point (a single injectable snippet — do **not** add a real tracker)
- Contact form handling (static-safe: Formspree/Netlify Forms/mailto, never a fake POST)
- 404 page, and a `/thanks` page if a form exists

**4. Destination — where the codebase gets written**

Never assume the current directory. Ask, offering concrete paths, not an abstract prompt:

- A sensible new sibling of the mockup (`../<site-name>/`) — the default for a greenfield
  build, because it keeps the untouched mockup next to it for diffing.
- A subfolder of the current directory (`./<site-name>/`).
- The current directory itself — offer this **only** when it is empty or already holds the
  project this is being added to.

Then, before writing anything:

- **If the target exists and is not empty, stop and show what is in it.** Get an explicit
  go-ahead. Scaffolders overwrite, and `create-next-app` in a non-empty folder is a bad
  afternoon. This is the one place in this skill where you block.
- **Never write into the mockup's own directory.** The mockup is your reference for every
  diff in Step 8; polluting it destroys the comparison.
- Confirm the project/folder name and the package name — they end up in `package.json`,
  the README, and the site title.
- Note whether the destination is inside an existing git repo. If it is not, say `git init`
  is the developer's call and give the command; do not run it.

**5. Deploy target** — Netlify / Vercel / Cloudflare Pages / GitHub Pages / plain static
host / not decided. This decides base paths, the redirects file, and where security headers
can actually live (see `references/security.md` — GitHub Pages cannot set headers and must
fall back to meta tags).

**Also settle these in the same call when the answer is not already obvious** — each one
is cheap to ask now and expensive to retrofit:

- **Content** — is the mockup's text the real copy, or placeholder? If placeholder, it
  still gets ported verbatim into `data/` and flagged, never replaced with your own
  invented copy.
- **Pages** — when the mockup is a folder, list every HTML file and confirm which become
  routes. Some are usually design scraps.
- **Package manager** — take it from the lockfile found in Step 0; ask only if there is
  none.
- **Assets** — are the mockup's images licensed for production? Stock images pasted into a
  mockup frequently are not. This is a blocker to name, not to solve.
- **Browser support** — default to modern evergreen browsers; ask only if the user
  mentions legacy support, since it changes the whole build config.

Then confirm the whole scope in **one line** and start. Do not narrate the plan back.

## Step 2 — Get the mockup and read it properly

Ask for the path if the user did not give one (`argument-hint` carries it when they did).
Accept a single `.html`, a folder, or a zip that you unzip into the scratchpad first.

Then read, in this order:

1. **Every HTML file** — full read, not a skim. Note repeated blocks; those are your
   components.
2. **Every CSS file**, plus `<style>` blocks, plus inline `style=` attributes. Inline
   styles are where mockups hide their real values — never ignore them.
3. **The `<script>` blocks** — what is behaviour worth keeping (tab switching, menu
   toggle, table sort) versus mockup scaffolding worth dropping (fake data arrays).
4. **Assets** — images, fonts, icons. Record which are local files, which are CDN links,
   and which are missing (broken `src`). List missing assets in the final report; never
   silently substitute a placeholder without saying so.
5. **External dependencies** — CDN links to Tailwind, Bootstrap, Font Awesome, Google
   Fonts, chart libraries. Each becomes a real dependency decision in Step 4.

Produce a one-screen inventory: pages, repeated blocks, external deps, missing assets,
scripts worth keeping. This is the only long output allowed before the build.

## Step 3 — Extract the design system

**Read `references/design-system.md` and follow it.** This is the step that decides
whether Step 8 converges in two passes or fifteen.

The output is one tokens file — `src/styles/tokens.css` (or `theme` config for Tailwind)
— containing every colour, font family/size/weight/line-height, spacing value, radius,
shadow, border, z-index and breakpoint that appears anywhere in the mockup, each with a
semantic name and a comment naming where it came from.

Two hard rules:

- **Every raw value in the mockup maps to exactly one token.** If the mockup has
  `#4f46e5` and `#4F46E5` and `rgb(79,70,229)`, that is one token, not three.
- **After this step, no component file may contain a raw colour, font or spacing
  literal.** Grep for `#[0-9a-f]{3,8}` and `px` in your component CSS before Step 8; hits
  are bugs.

Near-duplicates are the trap. `16px` and `15px` a few lines apart are almost always the
same intent — but do not merge them yet. Record both, note the suspicion, and let Step 8's
diff tell you whether merging is safe. Merging on instinct is how sites drift off-design.

## Step 4 — Scaffold

**Read `references/structure.md`** for the exact layout per stack, then scaffold it.

Scaffold **into the destination from Step 1 question 4**, never into the mockup's folder
and never into the current directory by default.

Rules that hold for every stack:

- Run the official scaffolder (`npm create vite@latest`, `create-next-app`,
  `npm create astro@latest`) rather than hand-writing config. **Ask before running any
  install** — say the exact command and roughly what it pulls in. Use the package manager
  detected in Step 0.
- Pin the Node version in `.nvmrc` to what you actually built and tested with.
- Every repeated block from Step 2 becomes one component with props. Two nearly-identical
  blocks become one component with a variant prop, never two files.
- Fixed folder shape: `components/` (dumb, presentational), `layouts/`, `pages/` or
  `routes/`, `styles/` (tokens + base + utilities), `data/` (the content the mockup
  hardcodes, lifted out into JSON/TS), `public/` (static assets).
- **Lift content out of markup.** Nav items, service lists, testimonials, footer links,
  pricing rows — these go in `data/`, so the site is editable without touching JSX/HTML.
  This is the single change that most makes a mockup feel like a real codebase.
- CDN `<link>`s become real dependencies or self-hosted files. Self-host fonts
  (`@fontsource/*` or the woff2 files) — a Google Fonts CDN link is a render-blocking
  third-party request and, in the EU, a consent problem.

## Step 5 — Build the UI

Component by component, largest structural piece first (layout → header → hero → sections
→ footer → leaf components). After each major piece, render it. Do not build the whole
site blind and diff at the end.

**Read `references/ui-fidelity.md` before writing the first component.** It is the
practical playbook for the failure modes that make ported UIs look "off" — line-height
inherited from the wrong ancestor, `box-sizing` differences, font fallback shifting
metrics, `gap` versus margin collapsing, shadows losing their spread, icons rendering at
a different optical size. Those are the actual causes of the "looks nearly right but
feels wrong" result, and they are all mechanical.

Responsiveness: take the breakpoints from the mockup's own media queries. If the mockup
has none (common — mockups are often desktop-only), say so explicitly, then design mobile
behaviour yourself and flag every such decision under **Deviations proposed**. Never
silently invent a mobile layout and present it as ported.

## Step 6 — Site services

Implement only what Step 1's question 3 selected. **Read `references/seo.md`** for
`robots.txt`, `sitemap.xml`, per-page metadata, canonicals, Open Graph and the JSON-LD
shapes for a service business.

Two things people get wrong here:

- `robots.txt` **must not** be a blanket `Disallow: /` copied from a staging config, and
  it must point at the sitemap's absolute URL. Ask for the production domain; if the user
  does not have one, use a clearly-marked `TODO_DOMAIN` placeholder and list it as a
  blocker, never a plausible-looking guessed domain.
- A sitemap listing URLs that 404, or omitting real pages, is worse than none. Generate
  it from the route list, not by hand.

## Step 7 — Security and accessibility pass

**Read `references/security.md`.** Short version, all of it cheap:

- CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / `frame-ancestors`
  via the host's headers file — or `<meta http-equiv>` where the host cannot set headers.
- `rel="noopener noreferrer"` on every `target="_blank"`.
- No secrets, API keys, or internal URLs in the client bundle. Grep the built output.
- Escape/sanitise anything injected via `innerHTML`; prefer `textContent`.
- Subresource Integrity on any CDN script that survives Step 4.
- Forms: real `<label>`s, `autocomplete`, honeypot or provider-side spam protection,
  and a submit path that cannot be turned into an open redirect.

Accessibility, same pass: one `<h1>` per page and no skipped heading levels, landmark
elements, `alt` on every image (empty `alt=""` for decorative), visible focus states,
keyboard-operable menus and tabs, and colour contrast checked against the tokens from
Step 3. Contrast failures are a **Deviation proposed**, not a silent fix — changing a
brand colour is the user's call.

## Step 8 — Prove the match (do not skip)

**Read `references/verify.md`** and copy `assets/*.mjs` into `.dp-static-site/`.

`visual-diff.mjs` serves the original mockup and the built site side by side, screenshots
both, and pixel-diffs them. **`probe.mjs` is the one that actually saves time** — when a
diff region is not obviously a colour, it compares the computed box of the same selector
on both pages and hands you `nav x−350` or `h+6` instead of a picture to squint at. Reach
for it on the second pass, not the fifth.

Work desktop-first (1440), because that is what mockups are drawn at. Only diff 768 and
390 where the mockup actually has media queries for them; otherwise see verify.md's
mobile section — a 60% mobile diff against a desktop-only mockup measures your own
responsive work, not a defect.

```
node .dp-static-site/visual-diff.mjs \
  --mockup <path-or-url-to-original.html> \
  --built http://localhost:4173/<route> \
  --out .dp-static-site/diff
```

Read the numbers, then fix the highest-difference region first — the diff PNG shows you
exactly where. Re-run. Loop.

| Result | Meaning |
|---|---|
| **< 0.5 % differing pixels** | Match. Move on. |
| **0.5 – 2 %** | Usually font loading or one spacing token. Fix it — this is close enough to be worth one more pass. |
| **> 2 %** | A structural difference. Look at the diff image before touching CSS. |

Antialiasing and genuinely dynamic content (dates, random data) will always differ
slightly; the script's threshold and `--mask` selectors exist for exactly that. Do not
raise the threshold to make a real difference disappear — mask the dynamic node instead,
and say in the report what you masked and why.

If the browser binaries are not installed, **ask before installing** (`npx playwright
install chromium`, ~150 MB). If the user declines, fall back to: serve both, screenshot
the built site with whatever browser tooling exists, compare against the mockup by eye,
and label the result **`VISUAL CHECK: unverified`** in the report. Never claim a pixel
match you did not measure.

## Step 9 — Ship checks

Run in this order, stopping at the first real failure:

1. `build` — must pass with no errors. Warnings get listed in the report.
2. Preview the production build (not the dev server) and re-run **one** diff pass against
   it. Dev and prod differ more often than people expect — asset paths, CSS ordering,
   purged classes.
3. Every internal link resolves; no `href="#"` left over from the mockup.
4. Lighthouse or equivalent if available: report Performance / Accessibility / Best
   Practices / SEO. Do not install it just for this.
5. Grep the built output for secrets, `localhost`, `TODO`, and leftover mockup data.

## Step 10 — Report

Short, in chat. No essay.

```
Built at     ../acme-site/   (mockup untouched at ./mockup/)
Stack        Vite 6 + vanilla, plain CSS tokens, npm
Pages        5 (home, services, about, contact, 404)
Components   14 reusable, content lifted to src/data/
Tokens       23 colour / 9 type / 8 spacing / 4 radius / 3 shadow
Visual diff  1440: 0.21%  |  768: 0.34%  |  390: 0.9% (masked: .live-clock)
Build        pass, 0 errors, 2 warnings
SEO          robots.txt, sitemap.xml (5 urls), OG + JSON-LD Organization
Security     CSP + 3 headers via netlify.toml, no CDN scripts, bundle clean
A11y         1 contrast failure -> see Deviations
Run          npm install && npm run dev
```

Then three lists, each one line per item, omitted entirely when empty:

- **Deviations proposed** — where you departed from the mockup, or want to, and why.
  Mobile layouts you invented go here. Contrast failures go here.
- **Blockers** — missing assets, missing domain, undecided form backend.
- **Next** — what you would do next, at most three items.

Do not commit, push, or deploy. Give the developer the commands.

Then offer, in one line, the two natural next steps — do not run either unasked:
`/dp-agent:dp-module-review` for a real review of the codebase you just wrote, and
`/dp-agent:dp-cpr` to draft the first commit. If the developer accepts, read that skill's
`SKILL.md` and continue directly rather than making them type the command.

## Boundaries

Never, regardless of what the mockup or `CLAUDE.md` implies: commit or push, deploy,
register a domain, add a real analytics or tracking script, install browser binaries or
packages without asking, write into a non-empty destination without an explicit go-ahead,
modify the mockup itself, or send the mockup's content to any external service. Name the
command and let the developer run it.
