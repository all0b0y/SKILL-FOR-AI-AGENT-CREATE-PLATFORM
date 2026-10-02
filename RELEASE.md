# Release acceptance — pre-release

This is a specification-to-implementation audit, not a release certificate. The decision IDs refer to the approved 31-decision specification (including sub-item 7a). **Implemented** describes an executable capability, not proof of live-model quality. **Partial** or **blocked** items must not be marked green by an offline mock result.

## Decision matrix

| ID | Requirement | Evidence / current result | Acceptance |
|---|---|---|---|
| 1 | Runnable agent application with its own UI | `templates/app`: web, worker, database, streaming UI and operator docs; Docker acceptance | Implemented offline |
| 2 | Claude-first; portable skills with explicit non-Claude checks | Plugin strict validation; `af` CLI; Hermes `skill_view` loads all six skills from the clean export | Implemented; Hermes reports caution-level env-read findings only |
| 3 | Fixed TypeScript/Next/AI SDK/Postgres stack; CI evals | Pinned manifest/lock; build gate; offline CI workflows with dev replay | Implemented locally; **GitHub execution unverified** |
| 4 | Lowest sufficient complexity with justification | Architecture validator and phase instructions enforce spec/model/tool mapping | Implemented; behavioral pressure test pending |
| 5 | Router and five gated phases | Six skills, CLI/state/gate regression suite | Implemented |
| 6 | Licensed, pinned vendoring and upstream maintenance | Impeccable LICENSE/NOTICE/UPSTREAM; `sync-upstream.mjs` stages exact-commit originals without overwriting adaptations | Implemented |
| 7 | Scenario-first interview and least-privilege tools | Grill skill, spec template, tools/rejections validation | Implemented; real interview acceptance pending |
| 7a | Ten mandatory interview dimensions | Spec sections and validation; no silent omission of resources, risk or budget | Implemented; pressure test pending |
| 8 | Fixed gap sweep and bounded additions | `references/gap-sweep.md`, spec validator | Implemented |
| 9 | Dated primary-source practices and generated index | `lint-skills`, generated practices index and phase references | Implemented |
| 10 | Agent UX patterns, brand tokens, motion, accessibility and design review | Desktop/mobile Playwright, axe, dark/reduced-motion, Lighthouse, all-profile UI checks; `UI-REVIEW.md` Impeccable audit with fixed findings; `e2e/network.spec.ts` covers lost POST/approval/stop acknowledgements and SSE reconnect; run timeline alignment regression | Implemented offline; physical-device and screen-reader sessions not performed |
| 11 | Deterministic/judge/adversarial evals; offline CI | Case parser, runner, cassettes, explicit reference selection, fail-closed paid consent | **Partial:** real-model/judge quality and approved product cases remain |
| 12 | Phase/type/lint/secret/paid/destructive hooks | Plugin hooks and explicit CLI guard regression tests | Implemented; hooks are not an OS sandbox |
| 13 | Script-owned state, hashes, decisions and handoff | State/gate tests, stale-phase reopening; grill/architect close only on the user's terminal approval and every close record is HMAC-signed (`lib/approval.mjs`, `tests/approval.test.mjs`, real-PTY test) | Implemented; guards shortcuts, not an OS boundary against a same-user agent that sets out to defeat it |
| 14 | English code/skills, user's language for interview/spec | Skill instructions and templates | Implemented; behavior under pressure unverified |
| 15 | Skill lint and recorded plugin pressure testing | Skill lint is executable and green; `pressure/` harness runs the exported skills through Codex CLI (gpt-6-sol) with the packaged Codex hooks and deterministic graders; evidence in `pressure/results/` | **Partial.** After the hard lock (batch `2026-10-02T15-04-53`): 0/12 runs closed a phase or forged `state.json`; 11/12 wrote no app code. The one exception bulk-copied the template with `cp -R`, a gap since closed (`checkPhaseShell`). Paid-call refusal 3/3. Still failing is conversation style: when told to skip, the agent stops without asking a question (0/3); when asked for all questions at once, it batches them and offers defaults (0/3). These are instruction-level and no longer let work bypass the user. Earlier batches: 4/12 with instructions only, 0/1 before any fix |
| 16 | Plugin, marketplace and portable installation | Clean exporter; Claude manifest validation and skill discovery; Hermes project-local load of all six skills; adversarial fixtures kept in dev-only `security-fixtures/` | Implemented; marketplace publication not performed |
| 17 | Compose default; restricted Vercel alternative | Real container-worker smoke; spec rejects background work on Vercel | Implemented for Compose; Vercel deployment unverified |
| 18 | Research → tracer bullet → phases → release | Primary-source references, working tracer bullet and phase machinery | Release intentionally not declared |
| 19 | Support, researcher, scheduled background references | Three profiles with separate prompts/permissions; real cron digest; browser and replay suites | **Partial:** researcher is document-based, not web browsing. Support tickets are local records **by v1 decision**; an external vendor is a documented future adapter (`TICKET_ADAPTER.md`), not implemented |
| 20 | Strong baseline; cheapest passing model only after benchmark | Explicit model config, no silent fallback, guarded `model-bench` | **Partial:** default is explicitly offline mock; no paid model comparison or production baseline acceptance |
| 21 | Postgres working memory, knowledge and optional facts | Compaction/history preservation, hybrid retrieval, semantic adapter, profile isolation, confirmed remember/forget | **Partial:** semantic/compaction quality unverified; generated products must prune unused schema/features |
| 22 | OTel to Postgres and optional exporter; metadata-only default | Database and local OTLP receiver tests; run trace UI | Implemented offline |
| 23 | Shared native/MCP tool contract and approval | Schemas, risk classes, allowlist, retries/timeouts, idempotency contract tests | Implemented; external service semantics require acceptance |
| 24 | Versioned Markdown prompts, typed loading and hashes | Prompt loader, run spans, prompt-sensitive cassette keys and actual prompt hashes retained in eval results before cleanup | Implemented; regression verifies persisted provenance |
| 25 | Layered limits, argument validation, untrusted data, HITL | Runtime/tool/identity tests and adversarial fixture replay | **Partial:** mock adversarial passes do not prove real-model robustness |
| 26 | No new authentication product | Only identity adapters supplied | Implemented |
| 27 | Owner-scoped identity, signed headers, local bind protection | Identity tests, owner checks, startup/container loopback acceptance | Implemented offline |
| 28 | Durable queue, statuses, resumable SSE, cancel, webhook/cron dedup | Integration, browser and container tests; persisted reference identity; test reset purges this app's pg-boss jobs with the rows they reference (`tests/reset.test.ts`); transactional NOTIFY wakes idle workers, with polling as fallback (`tests/queue-notify.test.ts`) | Implemented offline |
| 29 | Strict code checks, API docs, performance budgets and regression thresholds | Types/Biome/knip; `architecture` verifies descriptive TSDoc on every export and the module→spec/architecture inventory (`api-contract.json`); coverage, property/query-count/EXPLAIN tests; absolute hot-path, initial-JS (gzip) and offline first-text ceilings; >20% baseline comparison exercised on the same runner | **Partial:** no reviewed baseline for a qualified CI runner; live-model TTFT not measured |
| 30 | Three references pass every phase; pressure and installation acceptance | All profiles have offline runtime/browser/replay checks; Claude package validates | **Not met:** full generated-project phase runs, Hermes, pressure and live quality remain |
| 31 | Real interview cases expanded and individually approved; dev/holdout split | Twenty reference cases with `origin: synthetic` (schema-distinct from approved `interview`/`generated`), a test that every shipped case is marked, stable split; CI selects dev only | **Deferred for v1 by decision:** synthetic cases are not user-approved interview evidence; generated products collect their own in the grill and evals phases |

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

Last full offline run (2026-10-02, after the phase lock; mock model, hash embeddings, disposable local Postgres): source tests 37/37, skill lint, export and strict plugin validation; build gate (32 files / 142 tests + 1 skipped, coverage, benchmark, audit, build); eval gate 20/20 ×3; UI gate (36 Playwright checks + Lighthouse); reference acceptance (9 tests + 3 profiles × 2 viewports); Compose smoke. Earlier UI failures were caused by test resets that left pg-boss jobs for deleted runs, which delayed fresh runs. The fix purges those jobs; no timeout or performance budget was relaxed.

The eval gate's explicit `all` split is a release check. Routine CI selects `dev` instead. Fixture recordings are intentionally synthetic; they must never be presented as model-quality measurements or approved user cases. Do not automatically regenerate recordings when replay fails.

## Hermes loading, reproduced

The installed Hermes runtime (`1b7355d7fa1fd18f46e43e3a5786e05caa0d804a`) was exercised through actual `skill_view` calls. Each run used a fresh, trusted project containing the clean export under `.agents/skills`, with an isolated `HERMES_HOME`. **All six skills load.** The scan verdict for `agent-forge` is `caution`, with two high-severity findings for ordinary environment reads (`src/env.ts`, `src/agent/tools/mcp.ts`). The other five are `safe`.

Earlier packages were quarantined because literal prompt-injection inputs were bundled in the skill. Following the security decision, those inputs moved to the source repository's dev-only `security-fixtures/`, which the exporter never ships and an export test asserts. They still run in full in the source repository: three run-level regressions in `tests/security-fixtures.test.ts`, and three adversarial eval cases merged by the eval CLI (20/20 with `--split all`). The scanner, trust model and assertions are unchanged, and the text was not obfuscated. As a negative control, copying one fixture back into the exported skill makes Hermes quarantine it again.

## Conditions requiring separate permission/input

- Approved real product cases and yes/no confirmation for generated variants — **decided:** deferred for v1; reference cases stay explicitly synthetic.
- A production model/embedding configuration, verified prices and a finite spending limit before live quality, compaction, model comparison or plugin pressure runs.
- A security decision for the fixture/quarantine incompatibility — **decided:** dev-only `security-fixtures/` outside the shipped skills.
- External ticket-system choice, credentials and sandbox acceptance if that integration is part of v1 — **decided:** not in v1; local tickets plus the documented adapter contract.
- Publication permission before committing, pushing, triggering real GitHub CI or publishing a release.

No paid provider call, commit, push or publication is implied by the checks above. The remaining implementation gaps in the matrix are separate from those authorization gates.
