# Research summary — stage 1 (2026-10-01)

Inputs: `practices.md` (67 rules, 21 primary sources, all URLs return 200), `stack.md` (+ §10 verified against installed typings), `platform.md` (Claude Code docs + local `claude 2.1.281`), `plugin-evals.md` (raw doc), `vendor-plan.md`.

## Verified facts that the skills must encode (model training data gets these wrong)

| Area | Current fact | Verified by |
|---|---|---|
| AI SDK | `ai@7`: `ToolLoopAgent`, `isStepCount(n)` (default 20), `toolApproval` on agent/call (status `user-approval`/`approved`/`denied`), `experimental_toolApprovalSecret`, `telemetry` + `registerTelemetry()` (`experimental_telemetry` deprecated), `tool({ inputSchema })` | installed `ai@7.0.126` d.ts |
| MCP | `createMCPClient` from `@ai-sdk/mcp`, HTTP transport in prod | installed `@ai-sdk/mcp@2.0.65` |
| Queue | `import { PgBoss } from 'pg-boss'` (named), `send/work/schedule/cancel`, `singletonKey` for idempotency, `fromDrizzle` tx adapter | installed `pg-boss@12.35.1` d.ts |
| DB | Drizzle `0.45.x` (not 1.0-rc): native `vector()` column, HNSW `.using('hnsw', col.op('vector_cosine_ops')).with({...})`; `CREATE EXTENSION vector` added manually; `tsvector` via `customType` + generated column + GIN | installed `drizzle-orm@0.45.3` + docs |
| Next.js | `16.x`; `next lint` removed → Biome | docs |
| UI | Tailwind 4 (CSS-first `@theme`), `shadcn` CLI, `motion@13`; **AI Elements** (Apache-2.0 shadcn registry: Conversation, Message, Tool, Reasoning, Plan, PromptInput…) | npm + GitHub |
| Tooling | pnpm, Biome, knip, vitest 5 (`bench` built in), fast-check, Playwright + `@axe-core/playwright`, `@lhci/cli` | npm |
| Plugin | `.claude-plugin/plugin.json`, `skills/<name>/SKILL.md` → `/agent-forge:<name>`; skill dir `agent-forge` in plugin `agent-forge` loads as skill `agent-forge` | local `claude plugin validate --strict` + `plugin details` |
| Hooks | `PreToolUse` deny via `hookSpecificOutput.permissionDecision: "deny"` (or exit 2); `PostToolUse` uses top-level `decision: "block"` + `reason`; **a timed-out PreToolUse hook fails open** → explicit short timeouts + fast no-op path | docs |
| Plugin evals | `claude plugin eval` (Claude Code ≥2.1.269): `evals/<case>/prompt.md` + `graders/*.md`; graders `regex`, `tool_used`, `tool_order`, `file_exists`, `llm`, `baseline`; MCP mocks; no-plugin baseline arm (Δ); `--max-cost-usd`; paid | docs + `claude plugin eval --help` |
| Hermes | `npx skills add` has **no Hermes target**; Hermes installs via `hermes skills install` or trusted repo-local `.agents/skills` / `.hermes/skills` | `hermes skills --help` |

## Decisions taken by the orchestrator (derived from settled decisions; reversible)

1. **UI templates are built on AI Elements** (vendored source, Apache-2.0) + our agent-specific patterns (approval with diff preview, run timeline, cost meter). Reason: fixed-stack predictability (dec. 3, 10); copying source keeps ownership.
2. **Pressure testing of the set (dec. 15) runs on `claude plugin eval`** instead of a home-made harness: cases = scripted user + graders on `.agent-forge/state.json` (regex), `tool_used: Skill`, `file_exists`. Mocks keep it repeatable; `--max-cost-usd` caps spend; run manually.
3. **Hermes install path** in DoD (dec. 30) becomes `hermes skills install` / repo-local `.agents/skills`, not `npx skills add`.
4. **Lint = Biome, package manager = pnpm, queue = pg-boss** (stack.md §5, §7, §9).
5. **Hook scripts**: one Node script per hook, stdin JSON → stdout JSON, explicit `timeout`, same script callable manually under Hermes with `--check` flags.
6. Vendor additions: vercel-labs/web-interface-guidelines (MIT) replaces runtime fetch; AI Elements (Apache-2.0).

## Open conflict for the user

- **Eval set size.** Decision 7a: 5–10 cases from the interview. Anthropic (EV-01, EV-09): start with ~20 real cases and keep a held-out set. Needs a user decision.
