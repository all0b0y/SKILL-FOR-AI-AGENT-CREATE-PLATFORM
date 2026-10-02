---
name: agent-forge-architect
description: Use when /agent-forge routes to the architect phase, or `af status` shows architect open or stale. Picks the lowest sufficient rung and fills ARCHITECTURE.md.
license: MIT
---

# agent-forge · architect

Turn the closed spec into `.agent-forge/ARCHITECTURE.md` (English) from [../agent-forge/templates/ARCHITECTURE.md](../agent-forge/templates/ARCHITECTURE.md). The gate cross-checks every row against `AGENT_SPEC.md`, so the architecture can narrow the spec but never widen it.

`af` = `node "${CLAUDE_SKILL_DIR}/../agent-forge/scripts/af.mjs"`.

## Steps

1. **Read** `.agent-forge/AGENT_SPEC.md` and `decisions.md` in full. Done when you can name every tool, surface, limit and eval case without looking.
2. **Rung.** Walk the ladder from the bottom and stop at the first rung that passes every eval case in the spec on paper:
   1. single model call with tools — the answer needs at most one round of tool use;
   2. workflow — the steps are known in advance: *chaining* (fixed sequence), *routing* (classify, then a specialised path), *parallelization* (independent sub-tasks), *evaluator-optimizer* (draft → critique loop with a clear criterion);
   3. one agent in a tool loop — the next step depends on what the last tool returned;
   4. orchestrator → workers — only with a named reason: parallel breadth, context overflow, or tool overload, backed by an eval failure of rung 3.
   Write `Why-not-lower` as the concrete eval case the rung below would fail. Done when the `## rung` section has no placeholder.
3. **Tools.** Copy every spec tool; add `approval: yes` for write/destructive, a timeout, and retries (0 for destructive). Done when the table mirrors the spec one-to-one.
4. **Models, memory, limits, runs, identity.** Copy from the spec; the main model is the spec's baseline. Memory kinds the spec disabled stay disabled — no table, no code. Name the idempotency key for every surface. Done when every section is filled.
5. **Guardrails.** Structure, deterministic and limits layers are always on. The classifier layer is on only when the spec's `Classifier` is `on`. Done when the table matches.
6. **Gate.** Run `af gate architect`; fix each `ERROR:`. An error asking for a new tool or a looser limit means the spec must change first: go back to `/agent-forge-grill` for that one question, re-close grill, then return. Done when the gate prints `OK`.
7. **Review with the user.** Show the rung with its reason and the tool table; ask "Approve this architecture?" Done on an explicit yes in the user's own message. Never approve on the user's behalf.
8. **Hand the close to the user.** After that yes and a green `af gate architect`, update `handoff.md`, give the user `af close architect` to run in their own terminal, and stop. Agent sessions cannot close this phase. Next: `/agent-forge-build`, once `af status` shows architect `closed`.

## Rules from practice

Sources and checks: [references/practices.md](references/practices.md). The ladder above is AR-01..AR-03 and AR-06. Also apply:

- Prefer agent-as-tool (orchestrator keeps control) over hand-offs at any multi-agent boundary (AR-05); one narrow responsibility per agent (AR-07).
- No tool is shared between agents that sit in different trust domains (AR-08).
- Each tool call is keyed `(run_id, step_id)` so a replayed step short-circuits instead of acting twice (AR-14).
- Run state is persisted after every step, so a killed worker resumes from the last completed step (AR-12, AR-13).
- Deploys drain in-flight runs before stopping the old worker (AR-18).
