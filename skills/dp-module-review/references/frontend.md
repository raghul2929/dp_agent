# Frontend and UI pass

Run when layer is Frontend or All.


## Tier 1 - always check (Quick and Deep)

These are the boring, critical items that get skipped without a list. Verify every one.

- [ ] No unescaped user content in templates or DOM writes.
- [ ] No secrets or internal endpoints in client code.
- [ ] Every client-side permission check is mirrored by server-side enforcement.
- [ ] Loading, empty, error, and permission-denied states are rendered.
- [ ] Double submit prevented.
- [ ] Client validation mirrors server validation, and the server stays authoritative.
- [ ] Listeners, timers, and subscriptions cleaned up.
- [ ] Numbers, dates, and currency formatted consistently with the rest of the app.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Security in the browser

- [ ] No unescaped user content: `innerHTML`, `v-html`, `dangerouslySetInnerHTML`, raw/safe template filters.
- [ ] No secrets, API keys, or internal endpoints embedded in client code or bundles.
- [ ] Tokens stored appropriately - httpOnly cookie preferred over `localStorage` for session tokens.
- [ ] Client-side permission checks are for UX only; confirm the server enforces the same rule. Flag any check that exists only in the UI.
- [ ] No user data in URLs that get logged or shared.
- [ ] External scripts/iframes: justified, pinned, sandboxed where possible.

## 2. Data and state

- [ ] Loading, empty, error, and permission-denied states all rendered - not a blank screen or a spinner forever.
- [ ] Failed requests surfaced to the user with a recoverable action, not swallowed.
- [ ] Stale data after mutation: lists and caches refreshed or invalidated.
- [ ] Race conditions: fast typing / rapid clicks / out-of-order responses landing in the wrong order.
- [ ] Double submit prevented - button disabled or request deduplicated.
- [ ] Optimistic updates rolled back on failure.
- [ ] Memory: listeners, subscriptions, timers, and observers cleaned up on unmount.

## 3. Forms

- [ ] Client validation mirrors server validation, and the server is still authoritative.
- [ ] Field-level error messages displayed next to the field, in plain language.
- [ ] Required, format, range, and cross-field rules all present.
- [ ] Unsaved-changes warning where losing input would hurt.
- [ ] File inputs: size and type checked before upload, progress shown, failure handled.
- [ ] Autocomplete, input types, and mobile keyboards sensible.

## 4. Correctness of display

- [ ] Number, currency, and date formatting consistent with the rest of the app and with the user's locale/timezone.
- [ ] Rounding shown matches rounding stored.
- [ ] Long text, long names, and large numbers do not break layout.
- [ ] Pagination/sorting/filtering state survives navigation where users expect it.
- [ ] Timezone: server UTC rendered in the user's zone, once.

## 5. Accessibility

- [ ] Keyboard reachable and operable; visible focus; no keyboard traps in modals.
- [ ] Semantic elements - real `button`, real `label` tied to inputs, headings in order.
- [ ] Images have alt text; icon-only buttons have accessible names.
- [ ] Colour contrast adequate; colour not the only signal.
- [ ] Errors and dynamic updates announced to assistive tech.

## 6. Consistency and quality

- [ ] Reuses existing components, tokens, and styles instead of new one-off variants - name the existing component and its path when flagging.
- [ ] Matches the app's existing spacing, typography, and interaction patterns.
- [ ] Responsive at the breakpoints the app supports; no horizontal scroll on the page body.
- [ ] Dark mode / theme support if the app has it.
- [ ] User-facing strings translated where the app translates.

## 7. Performance

- [ ] Bundle impact of new dependencies; heavy libraries lazy-loaded.
- [ ] Images sized and compressed; no full-resolution assets in thumbnails.
- [ ] Long lists virtualised or paginated.
- [ ] No expensive work on every render or every keystroke; debounce where needed.
- [ ] Requests batched rather than one per row.
