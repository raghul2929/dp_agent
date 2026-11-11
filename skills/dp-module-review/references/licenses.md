# Licence compliance pass

Checks what the project **uses** against the licence policy the team has declared. This is a compliance check, not legal advice: it never declares a licence "compatible" or "safe" - it says whether the use **matches the declared policy**, and sends anything ambiguous to a human.

Runs whenever the job includes dependencies, and always for a diff that adds or upgrades a dependency (even at Quick depth).

## 0. Find the policy first

Look, in this order, for: `LICENSE_POLICY.md`, `docs/license-policy.md`, a "License policy" section in `CLAUDE.md`. The format is `templates/license-policy.md`. Record in the project map: **mode** (`strict` / `permissive-family` / `report-only`), the allow / exception-eligible / deny lists, scope answers, distribution answers, and the exceptions register.

- **No policy found:** run in **report-only** mode - list licences by count with no verdict - and say once at the end that a declared policy would turn the list into a verdict. Do not invent a policy.
- **Policy silent on a point** (build tools, assets, hosted APIs): record it under *Not reviewed* as a question for the owner. Do not silently choose.
- **Never widen the allowlist.** If the policy says MIT and Apache-2.0 only, BSD and ISC are *exception-eligible*, not allowed.

## 1. Build the inventory

A table the report can carry: package, version, **SPDX id**, scope (`runtime` / `build` / `dev` / `vendored` / `asset`), path (`direct`, or `A -> B -> C` for a transitive one), policy result (`allow` / `exception` / `deny` / `unknown`), and **evidence** (`metadata` or `LICENSE read`).

Take versions from the **lockfile**, not the manifest range - the licence that matters is the pinned version's.

Tools, by stack. Use what is installed; never install; record what was missing.

| Stack | Licence listing |
|---|---|
| Node | `license-checker` or `license-checker-rseidelsohn` (`--production`, `--summary`, `--onlyAllow`), `pnpm licenses list`, `yarn licenses` |
| Python | `pip-licenses`, `liccheck`; without them, read `*.dist-info/METADATA` (`License-Expression`, `License`, `Classifier: License ::`) |
| PHP | `composer licenses` |
| Go | `go-licenses` |
| Rust | `cargo deny check licenses`, `cargo-license` |
| Java / Kotlin | Maven `license-maven-plugin`, a Gradle licence-report plugin |
| Ruby | `license_finder` |
| .NET | `dotnet-project-licenses` |
| Any | `trivy fs --scanners license`, `syft` (also produces an SBOM), `scancode-toolkit` (file level), `license_finder` |

With no tool, read the lockfile plus installed package metadata and **label every row `metadata`**. Metadata can be wrong or empty, so a flagged row must be confirmed by reading its LICENSE file before it is reported as more than `unverified`.

## Tier 1 - always check (Quick and Deep)

- [ ] The policy is located and recorded (§0), or the run is explicitly report-only.
- [ ] The inventory covers **transitive** dependencies from the lockfile, for **every** ecosystem in the repo (npm and pip and composer, not just the first manifest found).
- [ ] Each licence is normalised to an SPDX id and **expressions are evaluated**: `A OR B` - the project may choose, so judge by the best allowed option; `A AND B` - every term applies (`MPL-2.0 AND MIT` is not simply "MIT"); `WITH` exceptions noted.
- [ ] **Unknown, missing, `UNLICENSED`, `SEE LICENSE IN …`, or a custom licence is treated as deny until a human reads the LICENSE file.** Never assume permissive. A package with no licence at all is "all rights reserved".
- [ ] Every deny-listed licence in runtime or shipped code is a finding **with its dependency path**, so the fix targets the direct dependency that pulled it in.
- [ ] In `strict` mode, permissive licences outside the allowlist are reported **once, grouped by licence with a count** - a decision to take, not a stream of alerts.
- [ ] Packages installed from a git URL, tarball, local path or private registry (no registry licence metadata) have their LICENSE file read.
- [ ] **Vendored and minified third-party files** committed to the repo (`public/js`, `vendor/`, `static/`, copied snippets, bundled libraries) are inventoried; a file with no licence banner or neighbouring LICENSE is a finding.
- [ ] Fonts, icons, images, themes and stock media: licence checked **per asset**. A library's code licence says nothing about its icons or fonts - and font and icon licences (OFL, CC-BY) are usually outside an MIT / Apache allowlist.
- [ ] Optional and platform-specific dependencies that are not installed are recorded as **not scanned**, never as "unknown licence".
- [ ] **Shipped versus build-only** is decided for each row from the project's own build, not from the manifest section: some toolchains list build tools under `dependencies`, and a bundle contains only a subset of what is installed.
- [ ] A dependency added, upgraded or re-pinned in this diff is licence-checked, and a **change of licence between versions** is flagged.
- [ ] The project's own licence is declared (LICENSE file and the manifest field agree).
- [ ] Attribution obligations are met for what ships: MIT / BSD / ISC notices and Apache-2.0 LICENSE and NOTICE text are reproduced in the distribution (a third-party notices file, an about page, or banners the minifier keeps). For a bundle sent to browsers, check the minifier does not strip licence banners.

---

*Everything below is Tier 2 - consulted at Deep depth, or when Tier 1 surfaces something worth pulling on.*

## 1. Scope and interpretation

- [ ] Where the policy is silent, the owner's answer is recorded as `attested`: do dev-only and build-time tools count; do fonts, icons, container images, models and hosted APIs count.
- [ ] The distribution model is recorded. A hosted-only product still has network-copyleft exposure (AGPL, SSPL); a browser bundle, a binary or a container sent to customers triggers distribution obligations for GPL-family and attribution duties for permissive licences.

## 2. Copyleft specifics (flag; a human decides)

- [ ] GPL / AGPL / LGPL / MPL / EPL / CDDL: how the code is used - linked, modified, executed as a separate process, or used as a build tool. Weak-copyleft licences differ by linking style and by whether the component is modified.
- [ ] Combinations: some licences cannot be combined in one work (for example Apache-2.0 with GPL-2.0-only). Note when a policy-allowed licence meets a copyleft licence in the same artifact.
- [ ] A dual licence that offers a choice (`MIT OR GPL-2.0`) is fine if the allowed option is real; one whose other option is commercial (`GPL-3.0 OR Commercial`) is not a permissive licence.

## 3. Source-available and restricted licences

- [ ] BUSL, SSPL, Elastic-style, Commons Clause, "non-commercial", "no hosting as a service", user-count thresholds, field-of-use limits: none is open source; all are deny-by-default.
- [ ] **Relicensing events.** The lockfile may pin an old permissive version while an upgrade crosses to a source-available licence. Flag upgrade PRs and automated dependency updates that change a licence.
- [ ] Commercial component libraries (UI suites, editors, charts, grids) that declare a custom licence, need a licence key, or have a "community" tier with revenue or headcount limits.

## 4. Content, snippets and generated code

- [ ] Code copied from Q&A sites, blogs, gists or other repos: licence and attribution recorded (share-alike content licences are a problem for a closed or permissive codebase).
- [ ] Icons and artwork requiring attribution (CC-BY) have the attribution where users can see it.
- [ ] Code produced by AI assistants: the team has a stated provenance rule (duplicate-detection setting, review of long verbatim matches), and the policy says whether assistant output is treated as the author's own.
- [ ] Data files shipped with libraries (browser-compat data, language corpora, tokenizer vocabularies) carry licences separate from the library's code.

## 5. Containers and infrastructure

- [ ] Base images and OS packages: licence scan (`trivy image --scanners license` or `syft`), judged against the policy's scope answer.
- [ ] Third-party CI actions, Terraform providers and Helm charts: licence recorded.
- [ ] Scripts loaded from a CDN: the library's licence, and whether the CDN copy keeps its banner.
- [ ] SDKs for hosted services: the SDK may be MIT while the **service** is governed by separate terms - record both.

## 6. Patents and names

- [ ] Apache-2.0 includes a patent grant with a termination clause; MIT has no explicit grant. Note where a patent-sensitive component is MIT-only.
- [ ] Project names and logos used in the product follow the owner's trademark rules.

## 7. Evidence and process

- [ ] An SBOM (CycloneDX or SPDX) is generated and stored with each release.
- [ ] CI fails on a **new** deny-listed licence (an allowlist in the pipeline), so the policy is enforced when nobody is reviewing.
- [ ] The exceptions register has an owner, reason and expiry per row; expired exceptions are findings.
- [ ] Metadata is spot-checked: a sample of `allow` rows has its LICENSE file read, because declared licences are sometimes wrong, missing, or differ from the file in the tarball.
- [ ] Notices and attribution files are regenerated when dependencies change.

## Severity guidance

- **Critical** - a deny-listed licence in code that is **shipped** to users (a browser bundle, a binary, a customer container); a network-copyleft licence (AGPL, SSPL) in a hosted product's runtime path.
- **High** - a deny-listed licence in a runtime dependency that is not shipped; **no licence / unknown / custom licence** on a runtime dependency or vendored file; a non-commercial or field-of-use restriction on anything used commercially.
- **Medium** - permissive but outside a `strict` allowlist with no recorded exception; weak copyleft with unclear linking; missing attribution or NOTICE for shipped permissive code; a licence that changed in an upgrade; an expired exception.
- **Low** - a dev or build-only tool outside policy where the policy is silent; metadata mismatches with no practical effect; no SBOM.

Label every finding **`metadata`** unless the LICENSE file was read, and say which. A `metadata` finding is a lead for the owner, not a conclusion.
