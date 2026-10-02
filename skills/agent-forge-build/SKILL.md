---
name: agent-forge-build
description: Use when /agent-forge routes to the build phase, or `af status` shows build open or stale. Scaffolds the app from the template and grows it tracer bullet first, red/green after.
license: MIT
---

# agent-forge · build

Build the app the architecture describes on the fixed stack. Start from [../agent-forge/templates/app](../agent-forge/templates/app) — it already runs one **tracer bullet**: chat → queued run → agent loop → tool → approval → trace → UI. Every later change is a **red/green** slice that keeps the bullet flying.

`af` = `node "${CLAUDE_SKILL_DIR}/../agent-forge/scripts/af.mjs"`. Stack facts and current APIs: [references/stack.md](references/stack.md) — read it before writing AI SDK, pg-boss or Drizzle code; older APIs from training data do not compile.

## Steps

1. **Scaffold.** Copy `templates/app/` into the project root (next to `.agent-forge/`), `pnpm install`, `cp .env.example .env.local`, `docker compose up -d db`, `pnpm db:migrate`. Done when `pnpm af:build-gate` runs (red is fine).
2. **Tracer bullet green.** Build with `AF_MODEL=mock`, then run `pnpm exec playwright test e2e/chat.spec.ts`: the reply streams, tool cards appear and approval works. The harness owns its production web server and mock worker; stop any separate worker on the same queue first. Done when these real browser tests pass.
3. **Shape the registry to the spec.** Replace the template tools with the tools in `ARCHITECTURE.md`, one *red/green* slice per tool: a failing test at the tool's seam (success, actionable error, argument validation), then the minimum implementation. Remove template tools, tables and screens the spec does not use. Done when `src/agent/tools/registry.ts` lists exactly the architecture's tools and `pnpm test` is green.
4. **Memory, limits, guardrails, runs, identity** — each from its architecture section, each as a slice with its test first. Disabled memory kinds leave no table and no code. Update `api-contract.json` to `scope: "product"`; map every `src` module and its exact exports to existing section IDs in the approved `.agent-forge/AGENT_SPEC.md` and `.agent-forge/ARCHITECTURE.md`. Remove reference-only inventory rows rather than inheriting unused features. Done when `pnpm architecture` verifies document anchors, inventory parity and descriptive TSDoc on every export. This structural check does not prove semantic conformance; review each mapping against its tests.
5. **Prompts.** System prompt in `prompts/system.md` from the template structure (role, goal, tools and when to use them, boundaries, answer format, examples). Done when the prompt hash shows in the trace of a run.
6. **Gate.** `af close build` runs `pnpm af:build-gate`: typecheck, Biome, knip, unit + property tests, coverage of the tool registry and identity seam, query-count and EXPLAIN tests, `ARCHITECTURE` ↔ code map. Fix every failure it lists. Done when it prints `Closed "build"`.

## How code is written here

- **Simplicity first.** Minimum code for the spec: no abstraction with one call site, no option nobody asked for, no handling for impossible states. Every module traces to a spec item or an eval case.
- **Surgical changes.** Each diff touches only what the current slice needs; style matches the surrounding code.
- **Comments say why** — the invariant, the trade-off, the spec item or `decisions.md` row. A comment that restates the line is deleted.
- **TSDoc on every export**: purpose, non-obvious parameter units/defaults and errors; add examples where they clarify the contract rather than repeat types. Non-trivial algorithms (retrieval ranking, compaction, retry/backoff, queue claims) state their complexity `O(…)` and why this algorithm, and carry a `fast-check` property test.
- **Hot paths are measured**: `pnpm bench` with a separate, reviewed, hardware-matched baseline; a regression above 20 % is red. Browser bundle/render budgets and baseline commands are in `PERFORMANCE.md`. A `not-checked` baseline result is not a passed comparison. No N+1: query-count tests on list endpoints. Every frequent query has an index proven by an `EXPLAIN` test.
- New dependency → one row in `decisions.md` with the reason.

## Rules from practice

Sources and checks: [references/practices.md](references/practices.md). Tool design: few consolidated tools, unambiguous parameter names, token-capped responses with human-readable fields, actionable errors (BU-02..BU-06). Context: just-in-time retrieval, compaction past a threshold (BU-07, BU-08). Safety: untrusted content enters only through the single `asUntrusted()` wrapper, as user-role data (BU-09); structured outputs at trust boundaries (BU-14); guardrails run on every step (BU-13); failures go back into context with bounded retries, then escalate (BU-15, BU-17).
