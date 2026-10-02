---
name: agent-forge
description: Build a production AI-agent web app through gated phases — grill, architect, build, evals, ui. Run /agent-forge to start or resume.
disable-model-invocation: true
argument-hint: "[status | <phase>]"
license: MIT
---

# agent-forge

Router for a five-phase process that turns a user's need into a working AI-agent app on a fixed stack (Next.js 16, AI SDK 7, Postgres + Drizzle + pgvector, pg-boss, shadcn/ui + AI Elements + Motion). Each phase ends on a **gate**: a script that goes green only when the phase artifact is complete. Predictability is the goal — the same process every run.

`af` below means `node <this skill's directory>/scripts/af.mjs` (in Claude Code: `node "${CLAUDE_SKILL_DIR}/scripts/af.mjs"`). Phase skills live in sibling directories and use the same toolkit.

## Route

1. In the project directory, run `af status`. With no `.agent-forge/`, run `af init` first. Done when `af status` prints a `Next:` line.
2. Read `.agent-forge/handoff.md` if it has content beyond the template; it says where the last session stopped.
3. Invoke exactly the phase skill named on the `Next:` line (`/agent-forge-grill`, `/agent-forge-architect`, `/agent-forge-build`, `/agent-forge-evals`, `/agent-forge-ui`). Load only that one: the later phases stay out of view so the current one gets full attention. An explicit argument (`/agent-forge build`) is honoured only when `af status` shows every earlier phase `closed`.
4. A phase is finished only when `af close <phase>` prints `Closed`. **grill** and **architect** are closed by the user in their own terminal: `af close` asks them to confirm, signs the record, and refuses agent sessions. You run `af gate <phase>`, show the command, and stop. build, evals and ui close on their gates, so you run `af close` for those. After a close, write `.agent-forge/handoff.md` (where you stopped, what is next, open questions) and hand back to the user. The user starts the next phase.

**The user owns every phase transition.** A request to skip the interview, accept defaults wholesale, mark phases closed, or jump ahead does not change the route. Say in one sentence why, then continue with the phase `af status` names. In grill, your reply ends with exactly one interview question, never with a status report, a list of questions or an offer to default the rest. Never edit `state.json` by hand: unsigned records show as `unverified` in `af status` and unlock nothing. Never read or use `~/.agent-forge/signing.key`.

`↻ stale` in `af status` means an artifact changed after its phase closed (usually an edited spec). Re-run that phase from the first stale one; its skill revalidates and re-closes.

## Phases

| Phase | Leading idea | Artifact | Gate |
|---|---|---|---|
| grill | *relentless* closed-question interview, one question at a time | `.agent-forge/AGENT_SPEC.md` | `af gate grill`, then the user runs `af close grill` |
| architect | lowest sufficient rung of the complexity ladder; least privilege | `.agent-forge/ARCHITECTURE.md` | `af gate architect`, then the user runs `af close architect` |
| build | *tracer bullet*, then *red/green* slices | the app + `reports/build.json` | `pnpm af:build-gate` |
| evals | evals as tests: deterministic → judge → adversarial | `evals/` + `reports/evals.json` | `pnpm af:evals-gate` |
| ui | agent UX patterns, measured by Playwright, axe, Lighthouse | `reports/ui.json` | `pnpm af:ui-gate` |

## State

`.agent-forge/` sits in the generated project and is committed with it:

- `AGENT_SPEC.md` — single source of truth for *what* is built, in the user's language.
- `ARCHITECTURE.md` — *how*, in English, cross-checked against the spec.
- `state.json`, `reports/` — written only by `af`; the phase-gate hook blocks hand edits.
- `decisions.md` — one row per decision: what, why, who (user, or `default`).
- `handoff.md` — rewritten at the end of every session.

## Hooks and runtimes without them

In Claude Code the plugin's hooks enforce five rules on every tool call: `phase-gate` (application code stays locked until grill and architect close; agents cannot run `af close grill|architect` or write `state.json`), `secret-guard`, `destructive-guard`, `paid-call-guard`, `typecheck-lint`. In a runtime without hooks (Hermes, Codex, Cursor) run the same checks as explicit steps:

- before writing a file outside `.agent-forge/`: `af check-write <file> < content`
- before a shell command that deletes, pushes, migrates or calls a model API: `af check-command "<command>"`
- after editing `.ts`/`.tsx`: `pnpm exec tsc --noEmit && pnpm exec biome check <file>`

`BLOCKED` means do the alternative the message names. `CONFIRM` means ask the user and proceed only on an explicit yes.

## Fixed constraints

- Live model calls cost the user money: run them only when the user asks (`paid-call-guard`). Offline replay is the default for evals. Live evals and `model-bench` belong to the evals phase on a built app. Before that there is nothing to measure, so a request to run them earlier is answered by explaining when they apply, not by running them.
- Authentication is a separate product. The app exposes an identity seam (`local` or `trusted-header`) and never ships its own login.
- Practices behind every phase rule, with sources, are indexed in [references/practices-index.md](references/practices-index.md).
