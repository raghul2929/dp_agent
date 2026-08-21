# Toolchain detection

Never assume a stack. Detect it, look up the tools, use what is installed, record what is not.

## 1. Detect

| Marker file | Stack |
|---|---|
| `package.json` | Node / JS / TS |
| `requirements.txt`, `pyproject.toml`, `Pipfile` | Python |
| `composer.json` | PHP |
| `go.mod` | Go |
| `pom.xml`, `build.gradle` | Java / Kotlin |
| `Gemfile` | Ruby |
| `*.csproj`, `*.sln` | .NET |
| `Cargo.toml` | Rust |

Multiple markers mean a polyglot repo - detect per directory and run the right tools in each.

## 2. Tool map

| Stack | Lint / typecheck | SAST | Dependency audit |
|---|---|---|---|
| Node | `eslint` (+ `eslint-plugin-security`), `tsc --noEmit` | `njsscan` | `npm audit --omit=dev`, `yarn npm audit`, `pnpm audit` |
| Python | `ruff`, `mypy` | `bandit` | `pip-audit`, `safety` |
| PHP | `phpstan`, `psalm`, `phpcs` | `phpcs --standard=Security-Audit` | `composer audit` |
| Go | `go vet`, `staticcheck` | `gosec` | `govulncheck` |
| Java | `spotbugs` | `find-sec-bugs` | OWASP `dependency-check` |
| Ruby | `rubocop` | `brakeman` | `bundler-audit` |
| .NET | `dotnet format` | Security Code Scan | `dotnet list package --vulnerable` |
| Rust | `cargo clippy` | `cargo-geiger` | `cargo audit` |
| **Any** | - | `semgrep --config=p/security-audit` | - |
| **Any** | - | - | `gitleaks detect`, `trufflehog filesystem` (secrets) |

`semgrep` covers 30+ languages and is the best fallback when a stack-specific SAST tool is absent. Use explicit rule packs - **never `--config=auto`**, which prompts for a login.

## 3. Rules

1. **Detect, never assume.** Read the manifest before naming a tool.
2. **Use what is installed. Never auto-install.** Installing changes the user's machine and is not part of a review.
3. **Record honestly.** If nothing is available, the coverage table says `SAST: none available for <stack>` and the review relies on the model passes. An honest gap beats a fake tick.
4. **Prefer the project's own scripts.** If `package.json`, `Makefile`, or `composer.json` defines `lint` / `test` / `typecheck`, run those rather than a guessed command - they encode the project's real configuration.
5. **Suggest once, at the end.** One line in the report: *"No SAST available for this stack; `<tool>` would cover X."* Never block on it.
6. **Feed results forward.** Whatever the tools found goes into every agent brief as *"already found, do not re-report"*. Deterministic tools should prune model work, not run beside it.

## 4. Shape detection - what layers actually exist

Detect this once, cache it in the project map, and let it drive what is offered and what is run. Never offer a layer the repo does not have, and never run a pass with no files to read.

**Frontend present** if any of: a components/views/templates/pages directory; `.jsx` `.tsx` `.vue` `.svelte` `.astro` or a server-template extension; a bundler config (vite, webpack, rollup, esbuild, parcel); a frontend framework in the manifest.

**Backend present** if any of: a server entry point; routes/controllers/handlers/services directories; a web framework in the manifest (express, fastify, adonis, laravel, django, flask, rails, spring, gin, .NET).

**Database present** if any of: a migrations directory; an ORM or query-builder in the manifest; `.sql` or schema files; model/entity directories; a database connection in config.

**Repo shapes**

| Shape | Signals | Consequence |
|---|---|---|
| Static site | markup, styles, scripts, no server framework, no DB | Frontend layer only. No backend, no database, no dependency-audit noise about server packages |
| Backend service / API | no view layer, no bundler | Backend and Database only. Never ask about frontend |
| Fullstack single repo | all three present | Offer all |
| Monorepo | `workspaces` in the manifest, or `packages/` `apps/` `services/`, or nx / turbo / lerna / pnpm-workspace config | Detect shape **per package**. Ask which package first, then apply that package's own shape |
| Library / SDK | no entry point, has exports and a published name | Correctness, quality, dependencies. Skip frontend, backend, database entirely |
| Infrastructure / config | terraform, k8s manifests, CI definitions, Dockerfiles | Security and config only. The code checklists mostly do not apply - say so rather than reporting nothing |

**Two rules that follow**

1. **Offer only what exists.** If exactly one layer is present, do not ask the layer question at all - state it and move on. Fewer questions and no wrong answers.
2. **Run only what the surface contains.** Even at layer `All`, skip a pass whose file types do not appear in the diff. A backend-only change gets no frontend pass. Record it in the coverage table as `N/A - no frontend files in surface`, which is honest and free.
