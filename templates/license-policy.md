<!--
TODO(team): This is the licence policy /dp-module-review and /dp-ai-review score a
project's dependencies, vendored files, assets and models against. Copy it to the
project root as LICENSE_POLICY.md (or paste the same headings under a "License policy"
section of CLAUDE.md) and fill it in. The review reads the policy from there.

Nothing here is legal advice, and the review never decides legal compatibility. It
compares what the project uses against the policy YOU write, and hands anything
ambiguous - custom licences, "SEE LICENSE IN", unknown, model terms - to a human.

If no policy is found, the review runs in REPORT-ONLY mode: it lists the licences it
found, with no allow / deny verdict, and says so once.
-->

# License Policy

## Mode

TODO(team): pick one and delete the others.

- `strict` - only the licences under **Allow** are accepted. Everything else needs a
  recorded exception. Use this when the rule is literally "MIT or Apache-2.0 only".
- `permissive-family` - the **Allow** list plus the permissive licences under **Exception-eligible**
  are accepted without a per-package exception.
- `report-only` - list licences found; no verdict.

Chosen mode: TODO(team)

## Allow

Accepted with no exception.

- MIT
- Apache-2.0

TODO(team): confirm. In `permissive-family` mode, add the family here (for example BSD-2-Clause,
BSD-3-Clause, ISC, 0BSD, Zlib, Unlicense, CC0-1.0, PSF-2.0).

## Exception-eligible

Permissive licences that are **not** on the Allow list. In `strict` mode each needs a
recorded exception, and the review reports them **grouped by licence** with a count -
not as one alert per package - so a handful of decisions replaces a wall of noise.

- BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, Unlicense, CC0-1.0, PSF-2.0, BlueOak-1.0.0, MIT-0

TODO(team): edit the list to what your team is willing to consider.

## Deny

Always a finding, in runtime or shipped code.

- GPL-*, AGPL-*, SSPL-1.0, BUSL-*, Elastic-2.0, Commons Clause, EUPL (when no alternative is allowed)
- CC-BY-NC-*, CC-BY-SA-*, any non-commercial, research-only, or field-of-use-restricted licence
- Proprietary / commercial licences, and any package with **no licence** or an unreadable one
- LGPL-*, MPL-*, EPL-*, CDDL-*: TODO(team) - deny, or allow only when used unmodified as a
  separate, dynamically linked or file-isolated component?

## Scope

TODO(team): answer each. The review asks the owner when a line is blank, and records the answer
as `attested`.

- Runtime dependencies: in scope (always)
- Build-time and dev-only tools that do not ship (bundlers, linters, test runners): in scope? yes / no
- Vendored or minified third-party files committed to the repo: in scope (always)
- Fonts, icons, images, themes, stock media: in scope? yes / no
- Container base images and OS packages: in scope? yes / no
- Machine-learning models, weights, tokenizers, datasets: in scope? yes / no
- Hosted APIs (a model or service reached over the network, governed by terms of service rather than an open-source licence): in scope? yes / no / separate terms review

## Distribution

TODO(team): this decides which obligations trigger. Tick every line that is true.

- [ ] Hosted service only (users never receive our code)
- [ ] Code is sent to users' browsers (a widget bundle, a front-end)
- [ ] We ship binaries, containers or packages to customers
- [ ] On-premises installs
- [ ] Our own code is published as open source under: TODO(team)

Note for the reviewer: "we only host it" does not make a network-copyleft licence (AGPL, SSPL) safe.

## Obligations the project already meets

TODO(team): where the attribution and notice files live (THIRD-PARTY-NOTICES, an About page,
a licence banner kept by the minifier), so the review can check they exist.

## Exceptions register

One row per approved exception. An exception without an owner, a reason and an expiry date is
reported as unapproved.

| Package / model / asset | Version | Licence | Why it is acceptable | Approved by | Date | Expires |
|---|---|---|---|---|---|---|
| | | | | | | |
