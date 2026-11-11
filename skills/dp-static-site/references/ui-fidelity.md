# UI fidelity — why ported UIs look "off", and how to stop it

Every item here is mechanical. None of it requires design taste. Work through it and the
diff in Step 8 converges in two passes instead of fifteen.

## The rule underneath all of it

**Copy the mockup's CSS declarations, then refactor them into tokens. Do not write CSS
from a description of what you see.** "A card with some padding and a subtle shadow" is
how a 4 % diff happens. `padding: 20px 24px; box-shadow: 0 1px 3px rgb(16 24 40 / 8%)`
is how a 0.2 % diff happens.

When a component looks close but wrong, open the mockup in the browser, inspect the node,
and read the **computed** styles. Computed beats authored, always — inheritance and
specificity mean the authored rule you found may not be the one that won.

## The top ten causes of drift

**1. Fonts not actually loaded.** By far the biggest single cause. The mockup pulls
Poppins from a CDN; your build self-hosts it but the `@font-face` is wrong, so everything
silently falls back to system sans. Line heights shift, widths shift, the whole page is
2 % off. Check first, every time: `document.fonts.check('16px Poppins')` in the console
of the built page, and compare the rendered `font-family` on `body` in both.

Match the fallback stack too — not just the primary. A different fallback changes metrics
during load and can change the screenshot if capture races the font swap. Use
`font-display: swap` in both, and let the diff script wait for `document.fonts.ready`.

**2. `box-sizing`.** The mockup almost certainly sets `*, *::before, *::after { box-sizing:
border-box }`. Some scaffolds do not. Every padded element is then wrong by its padding.
Set it in `base.css` before anything else.

**3. The framework's own reset.** Vite templates ship an opinionated `style.css`; Next's
`globals.css` and Tailwind's preflight normalise headings, lists and buttons to zero
margin. The mockup, built on browser defaults or Bootstrap, expected different ones.
**Delete the scaffold's starter CSS entirely** before writing yours — do not layer on top
of it and fight specificity.

**4. Line-height inheritance.** `line-height` on `body` cascades into elements that in
the mockup got theirs from a component rule. Set line-height explicitly on headings,
buttons, badges and table cells rather than relying on inheritance.

**5. Margin collapsing vs `gap`.** Rewriting a stack of margined children as
`display: flex; gap: 16px` changes the outcome whenever adjacent margins were collapsing.
If the mockup used margins, keep margins. Convert only after the diff is green, and re-run
the diff afterwards.

**6. Shadow and border precision.** `0 1px 3px rgba(0,0,0,.1)` and
`0 1px 3px rgb(16 24 40 / 8%)` look identical in isolation and light up a diff over a
large card. Copy the exact string.

**7. Icon rendering.** The mockup's Font Awesome glyph replaced by an inline SVG will
differ in optical size, baseline alignment and stroke weight. Fix by setting explicit
`width`/`height`, matching `stroke-width`, and aligning with
`vertical-align: -0.125em` or a flex parent — not by nudging margins.

**8. Image sizing and aspect.** `object-fit`, intrinsic dimensions, and `max-width: 100%`
interact. Always set `width` and `height` attributes on `<img>` to reserve layout space,
and match the mockup's `object-fit`/`object-position` exactly. Missing attributes also
cause layout shift, which the diff catches as a large false positive.

**9. Scrollbars.** A mockup screenshotted with an overlay scrollbar versus a built page
with a classic one shifts the content box by ~15px — a huge diff for a trivial cause.
Screenshot both the same way (the diff script does), and use
`scrollbar-gutter: stable` if the mockup reserved space.

**10. Rounding at breakpoints.** `rem` in one place and `px` in the other diverge at
non-default root sizes. Pick one unit per dimension and stay with it: `rem` for type,
`px` (via tokens) for borders and hairlines is a fine convention.

## The element-swap traps

Porting almost always changes what element a thing *is* — a div becomes an `<img>`, a
`<button>` becomes a `<Link>`, an inline style becomes a class. Every one of those swaps
changes inherited values, and each has bitten a real port:

**`<button>` → `<a>` / `<Link>`.** The single highest-yield item on this page. A UA
button has `line-height: normal` and `font-size: 13.333px`; an anchor inherits the body's
line-height and font-size. A CTA converted to a link is silently taller *and* wider. An
anchor is also `display: inline`, so its vertical padding does not contribute to the line
box and the whole section comes out short. Fix all three explicitly:

```css
.btn { display: inline-block; line-height: normal; font-size: 13.3333px; }
```

Apply the `font-size` only where the mockup's CSS set none — if it set one, it already
applied to the button too.

**Background-image div → `<img>`.** `background-size: cover` paints across the padding
box; `object-fit: cover` fits the *content* box. If the element has padding, the image
lands in a different place at a different scale — a 100% diff in that region for a
one-line cause. Zero the padding on the `<img>`, or keep it a background.

**Inline style → class.** Inline styles beat any class. Move a value into a class and it
can lose to an existing more-specific rule: `.quote { font-size: 17px }` loses to
`.main-content h2 { font-size: 32px }`, and the heading silently renders at nearly double
size. After moving any inline value into a class, check the computed style — do not
assume the class won.

**Inline `width` → responsive.** An inline `width: 1119px` cannot be overridden by a
media query, so it overflows every narrower viewport. Pass it as a custom property and
cap it in CSS: `width: min(var(--row-w), 100%)`. Exact at desktop, safe everywhere else.

**`<img>` where a div was.** An `<img>` is inline, so it sits on a text baseline and adds
~6px of descender space below itself, pushing the next element down. `display: block`
fixes it.

**A stylesheet background REPLACED by an inline one.** `.overlay { background: rgba(0,0,0,.3) }`
plus `style="background: url(...)"` means the scrim never renders — the inline shorthand
replaced it. Porting both the image *and* the overlay darkens the section by 30% against
the design. Read what actually wins, not what was authored.

## Empty elements are often load-bearing

Exported mockups are full of empty divs and headings. Before deleting one, check whether
it contributes margin, a line box, or a flex slot.

Two that have caused real breakage:

- An **empty `<h2>`** whose stylesheet `margin-bottom: 24px` was real spacing. Deleting
  it moved everything below it up by 24px.
- An **empty 0×0 `.logo` div** in a `space-between` header. Filling it with the brand
  name gave it width and slid the nav 350px across the header.

If an empty element carries layout, keep it, `aria-hidden` it, and say in a comment why
it cannot simply be deleted.

## Count your wrappers

A mockup that puts two rows inside *one* `<section class="content-section">` is not the
same as a component rendering two sections. At 80px of section padding each, that is
160px of phantom height. When a diff shows a constant vertical offset from a certain
point down, count the wrapper elements on both sides before touching anything else — the
probe's element count catches this instantly.

## Componentising without losing pixels

Two blocks in the mockup are "the same component" only if their computed styles agree.
Check before merging — a card in the sidebar with `padding: 16px` and one in the main
column with `padding: 24px` is one component with a `size` variant, and if you merge them
to a single padding you have just introduced a diff you will spend an hour chasing.

Variants belong in the component as explicit, named props (`variant="danger"`,
`size="sm"`), each mapping to a class that sets tokens. Never let a caller pass raw CSS.

Keep components presentational: no data fetching, no routing knowledge, no global state.
Content comes in as props from `data/`. This is what makes the codebase reusable rather
than a mockup with a build step.

## Responsiveness

Take the breakpoints from the mockup's media queries. Where the mockup has none:

- Below 640px: single column, stacked nav behind a toggle, full-width buttons, tables
  become card lists or gain a horizontally scrolling wrapper (**never** let the page body
  scroll sideways).
- 640–1024px: two columns where the desktop has three or four.
- Above the container max: centre with `--container-max`, do not stretch line lengths.

Every one of those is a decision you made, not something you ported — all of them go in
**Deviations proposed**.

Test at 320px too. It is the width where padding assumptions break, and it costs nothing.

## Interaction states

Mockups usually show only the resting state; the CSS often still contains the rest. Grep
for `:hover`, `:focus`, `:active`, `:disabled`, `aria-`, `.is-`, `.active` and port every
one you find. Where a state genuinely does not exist in the mockup, derive it from tokens
(hover = the `-hover` token or a 4 % darken; focus = a visible 2px ring in the primary
colour) and list it as a small deviation. A site with no focus state is not shippable
regardless of what the mockup showed.

Respect `prefers-reduced-motion` for anything animated.

## Before you call it done

- Diff green at 390 / 768 / 1440.
- No horizontal page scroll at any width from 320px up.
- Keyboard tab order is sane and focus is always visible.
- 200 % browser zoom does not break the layout.
- No raw colour, font or spacing literal in any component file.
