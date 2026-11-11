# Deriving the module registry

The registry is the one file that decides what a "cell" is. A good registry makes every later run cheap and exact. A bad one makes every edit re-queue half the project, or leaves code with no reviewer. It lives at `reviews/.ledger/registry.json` and is written only with `ledger registry set`.

## Format

```json
{
  "schema": 1,
  "ignore": ["**/*.generated.*", "docs/**", "**/__snapshots__/**"],
  "settings": { "ttl_days": 14, "manifests": ["tools/**/requirements.in"] },
  "modules": {
    "assistant": {
      "layers": {
        "backend": ["services/assistant/app/**"],
        "ai": ["services/assistant/llm/**", "services/assistant/prompts/**", "services/assistant/tools/**"]
      },
      "depends_on": ["shared-lib"]
    }
  }
}
```

- **`modules`** - the key is the module name: lowercase letters, digits, `.`, `_`, `-`. `project` is reserved for the dependency cell.
- **`layers`** - a map of layer to glob list. Allowed layers are `frontend`, `backend`, `database`, `ai`, `infra`.
- **`depends_on`** - modules whose changes can break this one. Direct dependencies only.
- **`ignore`** - files nobody should review: generated code, vendored copies, docs, snapshots. Ignoring is a decision, so say what you ignored.
- **`settings.ttl_days`** - how old the dependency audit may get before it re-runs. Default 14.
- **`settings.manifests`** - extra manifest globs for the dependency cell. JS/TS and Python manifests are built in.

The track (`normal`, `ai`, `hybrid`) is derived: a module with an `ai` layer and any other layer is `hybrid`. You never set it.

## Globs

- Patterns are **not** anchored like `.gitignore`. `*.py` matches only at the root. Write `**/*.py`.
- `**` crosses directories, `*` stays inside one, `?` is one character, `{a,b}` is alternation.
- A plain path with no wildcard matches itself and everything under it: `services/api` and `services/api/**` are the same.
- A leading `!` excludes: `["src/**", "!src/**/*.stories.tsx"]`.
- Absolute paths, `..` and backslashes are rejected.
- A file may sit in two cells (a `package.json` is in its module and in the dependency cell). Lockfiles belong to the dependency cell only.

## Layers

| Layer | What belongs in it | Reviewed by |
|---|---|---|
| `frontend` | UI code, components, pages, client state, styles, public assets that carry logic, the module's own `package.json` | `dp-module-review` |
| `backend` | HTTP handlers, services, jobs and workers, auth, business logic, models, config | `dp-module-review` |
| `database` | migrations, schema files, seeds, RLS or policy files, raw `.sql` | `dp-module-review` |
| `ai` | model call sites, prompts and prompt templates, retrieval and ingestion code, tool and agent definitions, evals, model configuration | `dp-ai-review` |
| `infra` | Dockerfiles, compose files, CI workflows, Terraform, Kubernetes and Helm, deploy scripts, `.env.example`, hosting config | `dp-module-review` |

A file belongs to the layer that decides how it is attacked. A prompt template is `ai` even though it is text. A route handler that calls a model is `backend` for its routing and auth, and its model call site is `ai`. Put the call site in both layers if they share a file. A duplicated file is cheap, and a file nobody reads is not.

## How to derive it

Start from `ledger scan`, then read the project.

1. **Find the packages.** Every directory holding a manifest (`package.json`, `pyproject.toml`, `requirements*.txt`, `setup.py`, `Pipfile`) is a candidate module. Workspaces mark the intended split: `workspaces` in `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `[tool.uv.workspace]`, `[tool.poetry]` path dependencies. A project with one manifest at the root and `src/` below is **one module**; name it after the package.
2. **Assign layers inside each package.** Use the evidence, not the folder name alone.
   - JS/TS frontend: `react`, `react-dom`, `vue`, `svelte`, `next`, `nuxt`, `@angular/core`, `solid-js`, `astro`. Next.js API routes (`pages/api`, `app/api`) are `backend`.
   - JS/TS backend: `express`, `fastify`, `koa`, `hono`, `@nestjs/core`.
   - Python backend: `fastapi`, `flask`, `django`, `starlette`, `tornado`, `sanic`, `celery`.
   - Database: `migrations/`, `alembic/`, `prisma/`, `drizzle/`, `supabase/`, `*.sql`, `schema.prisma`.
   - AI: take the files `ledger scan` lists, then add the folders that obviously go with them (`prompts/`, `llm/`, `ai/`, `agents/`, `rag/`, `retrieval/`, `embeddings/`, `evals/`, `tools/`, `mcp/`) and model configuration. `dp-ai-review/references/ai-surface.md` §1 has the full signal list.
   - Infra: `Dockerfile*`, `docker-compose*`, `.github/workflows/**`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml`, `terraform/**`, `*.tf`, `k8s/**`, `helm/**`, `deploy/**`, `infra/**`, `serverless.yml`, `vercel.json`, `netlify.toml`, `.env.example`. These usually form one module, `ops` or `infra`, with an `infra` layer.
3. **Find `depends_on` from imports, not from names.** A module depends on another when it imports it: a workspace package name (`@org/shared`), a relative path out of the package (`../../packages/shared`), a path dependency in `pyproject.toml` or `-e ../shared` in `requirements.txt`. Add a module that it only calls over HTTP when it relies on that module's auth, validation or contract. When unsure, add the dependency. It costs one small interface check, and leaving it out can miss a bug.
4. **Single-package projects.** One module, layers by folder. A server-rendered app that mixes UI and routes in one tree gets both layers over the same globs.
5. **Write it and verify it** with `ledger registry check` and `ledger coverage`. Fix every empty cell, every uncovered code or config file, and every AI file outside an `ai` layer, or record why it is ignored.

## Granularity

- **A cell should be what one reviewer can hold in their head**: roughly up to a few hundred files. A 3,000-file cell means every edit re-queues a review that is too large to be good.
- **Do not split finer than ownership.** Twenty three-file modules multiply dependents and interface checks for no gain. Aim for **3 to 12 modules**.
- **A shared library is its own module.** Everything that imports it lists it in `depends_on`, so a change to it re-queues them as a small interface check and not a full review.
- Changing a glob changes the cell's file set, so that cell is re-queued as changed. Settle the split on the first run and change it deliberately.

## Example: a hybrid project

A web UI, a plain API, an assistant (backend plus model), an ingestion pipeline that builds the retrieval index, and a shared library:

```json
{
  "schema": 1,
  "ignore": ["docs/**", "**/*.generated.*"],
  "modules": {
    "web-ui":     { "layers": { "frontend": ["apps/web/**"] }, "depends_on": ["shared-lib"] },
    "api":        { "layers": { "backend": ["services/api/**"], "database": ["services/api/migrations/**"] }, "depends_on": ["shared-lib"] },
    "assistant":  { "layers": { "backend": ["services/assistant/app/**"],
                                "ai": ["services/assistant/llm/**", "services/assistant/prompts/**", "services/assistant/tools/**"] },
                    "depends_on": ["shared-lib"] },
    "ingestion":  { "layers": { "ai": ["services/ingestion/**"] }, "depends_on": ["shared-lib"] },
    "shared-lib": { "layers": { "backend": ["packages/shared/**"] } },
    "ops":        { "layers": { "infra": ["infra/**", ".github/**", "docker-compose*.yml"] } }
  }
}
```

That is 8 cells plus the dependency cell. `assistant` is hybrid, `ingestion` is AI-only, and the rest are normal. `/dp-security` with scope *Normal only* skips the two `ai` cells. *AI only* runs just those two.

## Refreshing on later runs

`ledger coverage` shows what drifted. Typical changes and the registry edit each needs:

| What changed | Registry edit |
|---|---|
| A new package appeared | Add a module with its layers |
| A model SDK appeared in a manifest | Add an `ai` layer to the module that uses it (or make a new module). The new cell starts at `never` |
| New files import a model SDK | Add them to the module's `ai` layer |
| New CI or Docker files | Add them to the `infra` layer |
| A module was deleted | Remove it, then `ledger prune` to drop its stale cell records |
| A module now imports another | Add it to `depends_on` |

Propose the edit, show the diff of the registry, and confirm before `ledger registry set`.
