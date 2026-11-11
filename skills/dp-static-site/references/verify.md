# Verifying the built site against the mockup

The claim "it matches the design" is only worth anything with a number behind it. This is
how you get the number.

## The three scripts

`assets/` holds four Node scripts. They answer different questions, and reaching for the
wrong one wastes a lot of time:

| Script | Answers |
|---|---|
| `serve.mjs` | Serves a built directory with no dependency on `npx serve` |
| `visual-diff.mjs` | **Where** do the pages disagree, and by how much |
| `probe.mjs` | **Why** — compares the computed box of the same selector on both sides |
| `responsive-check.mjs` | Does anything overflow horizontally at 320/390/768/1024 |

**Use `probe.mjs` early.** Reading a diff image tells you a region is wrong; the probe
tells you it is `nav x−350` or `h+6`, which usually names the cause outright. On a real
port it took the home page from 8.15% to 0.39% in three passes, where guessing from the
image alone had been going in circles. Once every selector reports no delta, whatever
diff remains is colour, image content, or antialiasing — never layout.

## Setup (once per project)

```bash
npm i -D playwright pixelmatch pngjs
npx playwright install chromium          # ~150 MB — ASK THE USER FIRST
mkdir -p .dp-static-site
cp <skill>/assets/*.mjs .dp-static-site/
echo ".dp-static-site/" >> .gitignore
```

Add a script so the check is repeatable by a human, not just by you:

```json
"scripts": { "diff:ui": "node .dp-static-site/visual-diff.mjs" }
```

## Running it

Serve the built site first (`npm run preview`, `npm run dev`, or `npx serve dist`), then:

```bash
node .dp-static-site/visual-diff.mjs \
  --mockup ./mockup/index.html \
  --built  http://localhost:4173/ \
  --out    .dp-static-site/diff/home
```

One run per page. The script serves the mockup itself from its own directory, so relative
CSS, images and fonts resolve exactly as they do when the mockup is opened directly.

Output per viewport: `<w>-mockup.png`, `<w>-built.png`, `<w>-diff.png`, plus
`summary.json` with the percentages. Exit code is 1 when any viewport is over threshold.

**Read the diff PNG.** Red regions are where the pages disagree. The percentage tells you
whether to keep going; the image tells you where to look. Fix the largest contiguous red
region first — it is usually one cause producing most of the number.

## Reading the result

| Signal | Almost always means |
|---|---|
| `** font mismatch **` in the output | Fix this before anything else. Every other number is meaningless until the same font renders in both. |
| Height differs by more than ~8px | Structural: a missing section, a wrong `gap`, or a collapsed margin. Not a colour problem. |
| Solid magenta band in the diff | One page is taller; that band is padding, not a real difference. Fix the height first. |
| Diff evenly speckled everywhere | Font, `line-height`, or a global `letter-spacing` difference. |
| Diff concentrated in one block | That component. Inspect computed styles on both sides. |
| Diff only at edges of shapes | Antialiasing or a radius/border difference. Usually already under threshold. |
| 0.00 % at every width | Verify you are not diffing a page against itself — check the two PNGs actually differ. |

## Masking

Genuinely dynamic content will never match: clocks, "today", randomised demo data,
carousels mid-transition, video posters.

```bash
--mask ".live-clock" --mask "[data-random]"
```

Mask the smallest node that covers the dynamic value, and record every mask in the report.
Masking a component because it will not line up is falsifying the result — fix it or
report it as an unresolved difference.

Never raise `--threshold` to make a failure pass. The threshold describes antialiasing
tolerance, not the amount of wrong you will accept.

## Deliberate additions: `--remove-built`

Sometimes the right build contains something the mockup does not — a notice that a form
is not wired up, a skip link, a cookie banner. `--mask` will not help: `visibility:
hidden` keeps the element's box, so the page stays taller and the diff stays red.

`--remove-built <selector>` applies `display: none`, so the element takes no space and
you can measure whether *everything else* still lines up.

**Report both numbers, and lead with the as-built one.** "8.75% as built; 0.20% with the
added form notice excluded" is honest and useful. Quoting only the 0.20% is not — the
page a visitor sees is the 8.75% one. Never use `--remove-built` to make a defect
disappear; it is only for content you deliberately added and are declaring.

## Single-file mockups with hash routing

Exported mockups often hold every page as a hidden div switched by `location.hash`. Diff
each route against its fragment:

```bash
--mockup "mockup.html#about"   --built http://127.0.0.1:4173/about/
```

`visual-diff.mjs` splits the fragment off before touching the filesystem, so a hash on a
local path works.

## Mobile, when the mockup is desktop-only

Most mockups have no mobile design, or partial rules on some pages only. Diffing 390px
against a desktop-only mockup measures **your** responsive work against a page that is
simply overflowing — the number will be 25–70% and it means nothing.

So: diff desktop, and verify mobile a different way.

- Run `responsive-check.mjs`. No horizontal overflow at 320/390/768/1024 is the bar. It
  names the offending element when something does overflow, which is usually a ported
  fixed width or an unbreakable word.
- State plainly in the report that mobile was designed rather than ported, and list it
  under Deviations.
- Where the mockup *does* have media queries, port those rules exactly and diff at that
  width; only the gaps are yours.

Reporting a large mobile diff as a defect is as wrong as hiding it. Say what it measures.

## When Playwright is not available

If the user declines the browser install, degrade honestly:

1. Serve both pages.
2. Screenshot the built page with whatever browser tooling the environment has.
3. Compare against the mockup section by section, by eye, at all three widths.
4. Label the report line **`Visual diff: unverified (no browser available)`**.

Do not report a percentage you did not measure, and do not describe an eyeball check as a
pixel match.

## The manual pass the script cannot do

Screenshots are static. After the diff is green, click through once:

- Hover, focus and active states on every interactive element.
- Keyboard-only: tab through the page; focus visible at every stop; menus and dialogs
  operable and escapable.
- Menu/accordion/tab/modal open **and** closed.
- Form validation and the submit path.
- 320px width, and 200 % browser zoom.
- The production build, not just dev — CSS order, asset paths and purging differ.
