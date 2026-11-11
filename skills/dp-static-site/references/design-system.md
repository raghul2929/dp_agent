# Design system extraction

Read the mockup's CSS and turn it into tokens. This is archaeology, not design. You are
recovering the system the mockup author had in their head — you are not inventing one.

## 1. Harvest every literal

Sweep, in this order, and keep a raw list before you name anything:

| Source | Why it matters |
|---|---|
| External `.css` files | The bulk of it |
| `<style>` blocks | Often overrides the stylesheet |
| Inline `style=""` | **Highest specificity — this is where the real values hide** |
| Tailwind/Bootstrap classes in markup | The value lives in the framework's scale, not the file |
| `<svg>` `fill` / `stroke` attributes | Icon colours never appear in CSS |
| Canvas/chart config in `<script>` | Chart palettes are part of the design system |

Useful sweeps:

```bash
grep -ohE '#[0-9a-fA-F]{3,8}\b' mockup/**/*.{html,css} | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn
grep -ohE 'rgba?\([^)]*\)' mockup/**/*.{html,css} | sort | uniq -c | sort -rn
grep -ohE '[0-9.]+(px|rem|em)' mockup/**/*.{html,css} | sort | uniq -c | sort -rn
grep -ohE 'font-family:[^;]+' mockup/**/*.{html,css} | sort | uniq -c
```

Normalise before counting: `#FFF` = `#ffffff` = `rgb(255,255,255)` = one value. Frequency
is your signal — the value used 40 times is the primary; the one used once is probably an
accident, but port it as-is anyway and note it.

## 2. Name by role, never by appearance

`--color-primary`, not `--color-indigo`. `--space-4`, not `--space-16px`. The mockup's
purple becomes green one day and appearance-names become lies.

Reach for a two-level scheme when the palette has more than ~8 colours: a primitive layer
(`--indigo-600: #4f46e5`) and a semantic layer that references it
(`--color-primary: var(--indigo-600)`). Components use only the semantic layer. Below
that size, one flat semantic layer is less ceremony and just as good.

## 3. The token file

`src/styles/tokens.css` — nothing but tokens, grouped and commented with provenance:

```css
:root {
  /* ---- Colour ---- */
  --color-primary:        #4f46e5;  /* buttons, active nav — 41 uses */
  --color-primary-hover:  #4338ca;  /* :hover on .btn-primary */
  --color-surface:        #ffffff;  /* cards */
  --color-bg:             #f5f6f8;  /* page background */
  --color-text:           #1f2937;
  --color-text-muted:     #6b7280;  /* labels, table headers */
  --color-border:         #e5e7eb;
  --color-danger-bg:      #fde2e4;  /* the read-only warning banner */
  --color-danger-text:    #d61f4a;

  /* ---- Type ---- */
  --font-sans: "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --text-xs:   0.75rem;   /* 12px — table header caps */
  --text-sm:   0.875rem;  /* 14px — body default */
  --text-base: 1rem;
  --text-lg:   1.125rem;  /* 18px — card titles */
  --leading-tight:  1.25;
  --leading-normal: 1.5;
  --weight-regular: 400;
  --weight-medium:  500;
  --weight-semibold: 600;

  /* ---- Space (4px base) ---- */
  --space-1: 0.25rem;  --space-2: 0.5rem;   --space-3: 0.75rem;
  --space-4: 1rem;     --space-6: 1.5rem;   --space-8: 2rem;
  --space-12: 3rem;    --space-16: 4rem;

  /* ---- Radius / elevation / motion ---- */
  --radius-sm: 6px;  --radius-md: 10px;  --radius-full: 999px;
  --shadow-card: 0 1px 3px rgb(16 24 40 / 8%);
  --shadow-pop:  0 8px 24px rgb(16 24 40 / 12%);
  --transition: 150ms ease;

  /* ---- Layout ---- */
  --container-max: 1280px;
  --header-height: 64px;
  --z-dropdown: 100;  --z-modal: 400;  --z-toast: 500;
}
```

Breakpoints go in the same file as a comment block (custom properties do not work inside
media queries) and are used literally and consistently:

```css
/* Breakpoints — from the mockup's own media queries
   sm 640px | md 768px | lg 1024px | xl 1280px */
```

## 4. Dark mode

Only if the mockup has one. If it does, the tokens file is the *only* place that changes:

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --color-bg: …; } }
:root[data-theme="dark"] { --color-bg: …; }
```

Never define a colour solely inside a dark-mode block — light must be complete on bare
`:root`.

## 5. Base layer, then utilities

`src/styles/base.css`: reset (`box-sizing: border-box` on everything), body font and
colour from tokens, heading scale, link and focus-visible styles, `img { max-width: 100% }`.

`src/styles/utilities.css`: only the handful the mockup actually repeats — `.container`,
`.visually-hidden`, `.stack > * + *`. Do not build a utility framework by hand; if the
mockup wants that many utilities, the answer was Tailwind back in Step 1.

## 6. Verify before you build

- Every literal from step 1 maps to a token, or is written down as deliberately dropped.
- No component CSS contains a raw hex, `rgb(`, or a bare `px` outside borders and the
  1px hairline case. Grep for it.
- The token count is plausible: a typical mockup yields 15–30 colours, 6–10 type sizes,
  8–12 spacing steps. Three hundred tokens means you tokenised noise; four means you
  merged away the design.
