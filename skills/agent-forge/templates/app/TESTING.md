# Local verification

Use a disposable Postgres database. Integration tests truncate application tables; never point them at customer data. Tests require the explicit `AF_ALLOW_TEST_DB_RESET=1` opt-in. E2E uses real queue/database writes with the offline mock model.

From this template directory, with the environment configured locally:

```sh
pnpm typecheck
pnpm lint
pnpm knip
AF_ALLOW_TEST_DB_RESET=1 pnpm test
pnpm kb:ingest
pnpm evals --split all --repeat 3
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Load database and approval settings into the shell before the unit/eval commands; do not print secrets. Playwright starts its own production web server on loopback port 3100 and a mock-only worker from `.env.local`, and terminates both afterward. Do not run another worker against the same queue during these tests. Re-ingest knowledge after integration tests, which clear it. Stored recordings currently cover three repetitions; new cases or changed prompts require an explicitly authorized recording. Mock recordings verify plumbing, not real model quality.

The browser suite checks initial sending, consecutive-turn history, reload during approval, approval/rejection, cancellation with a subsequent turn, dark reduced-motion rendering, keyboard navigation, axe accessibility and mobile overflow. Network regressions cover lost submission/approval/cancel acknowledgements, safe retries and SSE resumption. The UI audit adds 200% text at a 320px viewport, long unbroken messages and approval payloads, control target sizing, and reopening a saved conversation through Runs. Screenshots are under `test-results/`. Model-only history repair closes interrupted exchanges without altering original transcripts or inventing successful tool results.

Docker excludes `.env*` (except the example), dependencies and local reports. Its build-only placeholder settings allow Next route discovery without operational credentials; they are not runtime defaults. Supply runtime settings when starting the container. The runtime requires Corepack because the entry point invokes pnpm.

Executable gates load `.env.local` without printing it:

```sh
AF_ALLOW_TEST_DB_RESET=1 AF_MODEL=mock pnpm af:build-gate
AF_MODEL=mock pnpm af:evals-gate
AF_MODEL=mock pnpm af:ui-gate
```

Build checks lint, types, unused dependencies, architecture boundaries, coverage, fixed-workload performance ceilings, dependency audit and production build. Evals run three repetitions in replay mode. UI checks Playwright/axe and three fresh Lighthouse runs (median performance >=90, accessibility 100, best practices >=95, SEO >=90). Reports are written under `.agent-forge/` and `.lighthouseci/`. MCP tests include an actual local HTTP server; OTel tests use a local HTTP collector plus Postgres. Neither calls a paid model.

Memory integration tests cover approval before saving/removing a preference, rejection, exact-preview and owner checks, repeated deletion, provenance, and preservation of source history. Benchmark CLI regressions reject duplicate model identifiers and empty case selections before any provider work; zero cases cannot select a winner.

The scoped `@esbuild-kit/core-utils>esbuild` override pins the Drizzle development loader to `0.25.12` to address [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). After changing this override, run `pnpm db:generate` (expect no schema changes on the unchanged schema), the build gate and the Compose smoke; remove the override when the upstream dependency no longer needs it.

`pnpm test:compose` builds and starts real web/worker containers against an isolated tmpfs Postgres, using generated test credentials and the mock model only. It checks fresh-schema migration, SSE, duplicate delivery, approval/forgery/replay, cancellation, follow-up citation, real cron dispatch with human approval, and a separate read-only background digest with three citations. Requires Docker Compose >=2.24.4 and free loopback port 3200 (`AF_SMOKE_PORT` overrides it). Existing databases, volumes and images are not deleted; only this run's containers/network and temporary override are removed. The real cron wait is bounded at 180 seconds.

`pnpm test:references` verifies each profile in the database and on desktop/mobile; see [REFERENCES.md](REFERENCES.md). The eval runner persists the case-selected reference and replays all three profiles without consulting the worker default. The shipped 20 cases are **synthetic generated fixtures**, not approved interview cases. CI runs the dev split; `pnpm evals --split all --repeat 3` is the explicit offline release check.

The standalone `.github/workflows/ci.yml` supplies an offline GitHub job with pinned actions, minimal token permissions and no paid credentials. Keep recorded responses under version control; never re-record automatically in CI to conceal a cassette miss.

See [PERFORMANCE.md](PERFORMANCE.md) for JavaScript/render-latency budgets, compatible baseline selection, and the >20% regression policy. Generated eval reports are excluded from source formatting checks, while cases and split files remain checked.

Remaining release work includes full architecture/spec parity, live-model compaction quality, [semantic quality acceptance](RETRIEVAL.md), and plugin pressure tests. A local baseline comparison does not qualify a different CI runner. A passing offline gate is not approval of the whole plugin release.
