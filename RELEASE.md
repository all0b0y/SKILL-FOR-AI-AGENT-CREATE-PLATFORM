# Release acceptance — pre-release

This is a specification-to-implementation audit, not a release certificate. The decision IDs refer to the approved 31-decision specification (including sub-item 7a). **Implemented** describes an executable capability, not proof of live-model quality. **Partial** or **blocked** items must not be marked green by an offline mock result.

## Decision matrix

| ID | Requirement | Evidence / current result | Acceptance |
|---|---|---|---|
| 1 | Runnable agent application with its own UI | `templates/app`: web, worker, database, streaming UI and operator docs; Docker acceptance | Implemented offline |
| 2 | Claude-first; portable skills with explicit non-Claude checks | Plugin strict validation; `af` CLI; Hermes runtime probe loads only five phase skills | **Blocked for Hermes** |
| 3 | Fixed TypeScript/Next/AI SDK/Postgres stack; CI evals | Pinned manifest/lock; build gate; offline CI workflows with dev replay | Implemented locally; **GitHub execution unverified** |
| 4 | Lowest sufficient complexity with justification | Architecture validator and phase instructions enforce spec/model/tool mapping | Implemented; behavioral pressure test pending |
| 5 | Router and five gated phases | Six skills, CLI/state/gate regression suite | Implemented |
| 6 | Licensed, pinned vendoring and upstream maintenance | Impeccable LICENSE/NOTICE/UPSTREAM; `sync-upstream.mjs` stages exact-commit originals without overwriting adaptations | Implemented |
| 7 | Scenario-first interview and least-privilege tools | Grill skill, spec template, tools/rejections validation | Implemented; real interview acceptance pending |
| 7a | Ten mandatory interview dimensions | Spec sections and validation; no silent omission of resources, risk or budget | Implemented; pressure test pending |
| 8 | Fixed gap sweep and bounded additions | `references/gap-sweep.md`, spec validator | Implemented |
| 9 | Dated primary-source practices and generated index | `lint-skills`, generated practices index and phase references | Implemented |
| 10 | Agent UX patterns, brand tokens, motion, accessibility and design review | Desktop/mobile Playwright, axe, dark/reduced-motion, Lighthouse, all-profile UI checks | **Partial:** full documented Impeccable review and network-retry coverage remain |
| 11 | Deterministic/judge/adversarial evals; offline CI | Case parser, runner, cassettes, explicit reference selection, fail-closed paid consent | **Partial:** real-model/judge quality and approved product cases remain |
| 12 | Phase/type/lint/secret/paid/destructive hooks | Plugin hooks and explicit CLI guard regression tests | Implemented; hooks are not an OS sandbox |
| 13 | Script-owned state, hashes, decisions and handoff | State/gate tests, stale-phase reopening | Implemented |
| 14 | English code/skills, user's language for interview/spec | Skill instructions and templates | Implemented; behavior under pressure unverified |
| 15 | Skill lint and recorded plugin pressure testing | Skill lint is executable and green | **Partial:** model-driven pressure tests have not run |
| 16 | Plugin, marketplace and portable installation | Clean exporter; Claude manifest validation and skill discovery | **Blocked:** core Hermes skill quarantined |
| 17 | Compose default; restricted Vercel alternative | Real container-worker smoke; spec rejects background work on Vercel | Implemented for Compose; Vercel deployment unverified |
| 18 | Research → tracer bullet → phases → release | Primary-source references, working tracer bullet and phase machinery | Release intentionally not declared |
| 19 | Support, researcher, scheduled background references | Three profiles with separate prompts/permissions; real cron digest; browser and replay suites | **Partial:** support tickets are local records, not a verified external ticket vendor; researcher is document-based, not web browsing |
| 20 | Strong baseline; cheapest passing model only after benchmark | Explicit model config, no silent fallback, guarded `model-bench` | **Partial:** default is explicitly offline mock; no paid model comparison or production baseline acceptance |
| 21 | Postgres working memory, knowledge and optional facts | Compaction/history preservation, hybrid retrieval, semantic adapter, profile isolation, confirmed remember/forget | **Partial:** semantic/compaction quality unverified; generated products must prune unused schema/features |
| 22 | OTel to Postgres and optional exporter; metadata-only default | Database and local OTLP receiver tests; run trace UI | Implemented offline |
| 23 | Shared native/MCP tool contract and approval | Schemas, risk classes, allowlist, retries/timeouts, idempotency contract tests | Implemented; external service semantics require acceptance |
| 24 | Versioned Markdown prompts, typed loading and hashes | Prompt loader, run spans, prompt-sensitive cassette keys and actual prompt hashes retained in eval results before cleanup | Implemented; regression verifies persisted provenance |
| 25 | Layered limits, argument validation, untrusted data, HITL | Runtime/tool/identity tests and adversarial fixture replay | **Partial:** mock adversarial passes do not prove real-model robustness |
| 26 | No new authentication product | Only identity adapters supplied | Implemented |
| 27 | Owner-scoped identity, signed headers, local bind protection | Identity tests, owner checks, startup/container loopback acceptance | Implemented offline |
| 28 | Durable queue, statuses, resumable SSE, cancel, webhook/cron dedup | Integration, browser and container tests; persisted reference identity; test reset purges this app's pg-boss jobs with the rows they reference (`tests/reset.test.ts`) | Implemented offline |
| 29 | Strict code checks, API docs, performance budgets and regression thresholds | Types/Biome/knip, architecture checks, coverage, property/query-count/EXPLAIN tests, absolute hot-path ceilings | **Partial:** complete exported-API TSDoc/spec mapping, bundle/TTFT budgets and hardware-matched >20% regression baselines remain |
| 30 | Three references pass every phase; pressure and installation acceptance | All profiles have offline runtime/browser/replay checks; Claude package validates | **Not met:** full generated-project phase runs, Hermes, pressure and live quality remain |
| 31 | Real interview cases expanded and individually approved; dev/holdout split | Twenty explicitly synthetic fixtures, stable split; CI selects dev only | **Not met:** synthetic cases are not user-approved interview evidence |

## Reproduce the offline checks

From the source repository:

```sh
node --test tests/*.test.mjs
node scripts/lint-skills.mjs
node scripts/export-package.mjs .agent-forge-tmp/new-release-candidate
claude plugin validate --strict .agent-forge-tmp/new-release-candidate/.claude-plugin/plugin.json
```

From the app template, using only a disposable database and locally configured test settings:

```sh
AF_ALLOW_TEST_DB_RESET=1 AF_MODEL=mock AF_EMBEDDING_MODEL=hash pnpm af:build-gate
AF_MODEL=mock AF_EMBEDDING_MODEL=hash pnpm af:evals-gate
AF_MODEL=mock AF_EMBEDDING_MODEL=hash pnpm af:ui-gate
AF_ALLOW_TEST_DB_RESET=1 pnpm test:references
pnpm test:compose
```

Last full offline run (2026-10-02, mock model, hash embeddings, disposable local Postgres): source tests 27/27, skill lint, export and strict plugin validation; build gate (29 files / 138 tests, coverage, benchmark, audit, build); eval gate; UI gate (36 Playwright checks + Lighthouse); reference acceptance (11 tests + 3 profiles × 2 viewports); Compose smoke. Earlier UI failures were caused by test resets that left pg-boss jobs for deleted runs, which delayed fresh runs. The fix purges those jobs; no timeout or performance budget was relaxed.

The eval gate's explicit `all` split is a release check. Routine CI selects `dev` instead. Fixture recordings are intentionally synthetic; they must never be presented as model-quality measurements or approved user cases. Do not automatically regenerate recordings when replay fails.

## Hermes blocker, reproduced

The installed Hermes runtime (`1b7355d7fa1fd18f46e43e3a5786e05caa0d804a`) was exercised through actual `skill_view` calls in a fresh, trusted project and isolated `HERMES_HOME`. `agent-forge` is quarantined; the five phase skills load. Critical findings point to literal adversarial inputs in:

- `templates/app/evals/cases/injection-user.yaml`
- `templates/app/tests/runs.test.ts`
- `templates/app/tests/references.test.ts`

There are also caution-level findings in operational source/configuration. Listing or project trust alone does not resolve quarantine. The scanner, trust classification and security fixtures have not been weakened or removed. A documented, narrowly scoped fixture-exclusion policy or an upstream scanner correction needs an explicit security decision; repackaging to hide the same content is not accepted as a fix.

## Conditions requiring separate permission/input

- Approved real product cases and yes/no confirmation for generated variants.
- A production model/embedding configuration, verified prices and a finite spending limit before live quality, compaction, model comparison or plugin pressure runs.
- A security decision for the fixture/quarantine incompatibility.
- External ticket-system choice, credentials and sandbox acceptance if that integration is part of v1.
- Publication permission before committing, pushing, triggering real GitHub CI or publishing a release.

No paid provider call, commit, push or publication is implied by the checks above. The remaining implementation gaps in the matrix are separate from those authorization gates.
