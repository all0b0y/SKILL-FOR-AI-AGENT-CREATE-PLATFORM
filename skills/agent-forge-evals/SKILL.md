---
name: agent-forge-evals
description: Use when /agent-forge routes to the evals phase, or `af status` shows evals open or stale. Turns spec examples into a red/green eval suite with record/replay and a holdout set.
license: MIT
---

# agent-forge · evals

Evals are the agent's tests. They run offline in CI on recorded model responses (*tight loop*: fast, deterministic, free) and live only when the user asks.

`af` = `node "${CLAUDE_SKILL_DIR}/../agent-forge/scripts/af.mjs"`.

## Steps

1. **Seed.** Run `pnpm evals:seed`: it writes one `evals/cases/<id>.yaml` per row of the spec's `## evals` table. Done when the file count equals the table's row count.
2. **Expand to ~20.** Propose variations of each real case (paraphrase, missing data, edge values) and adversarial cases from the spec's untrusted sources and gap sweep (prompt injection in a document, request for an unapproved write, cross-user data). Show the list; the user answers yes/no per case. Write accepted ones with `origin: generated`. Done when the suite has 15–25 cases and every adversarial case from the gap sweep exists.
3. **Graders, cheapest first.** Per case: deterministic checks wherever a ground truth exists (tool called with these arguments, schema match, no tool X, steps ≤ ceiling, cost ≤ budget, final state); `judge` with a numeric rubric only for free-form quality; adversarial cases use deterministic checks only. Done when `pnpm evals:lint` is green (every case has ≥1 grader, judge rubrics have named dimensions and a threshold).
4. **Split.** `pnpm evals:split` assigns ~25 % to `holdout` by a stable hash of the case id. Iterate only on `dev`. Done when the split file exists.
5. **Red.** Run `pnpm evals` (replay). New cases have no recording, so they are red — that is the starting point.
6. **Record.** Recording calls the real model: ask the user, then run `pnpm evals:record` (paid-call-guard asks for confirmation). Done when every dev case has a cassette.
7. **Green.** Change prompts, tool descriptions or code until every deterministic grader passes, every adversarial case passes, and judge scores meet the spec's threshold on `dev`. Re-record only cases whose prompt or tools changed (the cassette key includes the prompt hash). Done when `pnpm evals` is green.
8. **Holdout + consistency.** With the user's go-ahead: `pnpm evals:live --split holdout --repeat 3`. High-risk cases must pass all 3 repeats. Done when the report shows holdout ≥ threshold.
9. **Model bench (optional, paid).** If the user wants lower cost: `pnpm model-bench --models <a,b,c>` runs dev + holdout per model; the cheapest model that passes every gate wins; write the result in `decisions.md` and `ARCHITECTURE.md`'s models table (this reopens architect — re-close it).
10. **Close.** `af close evals` runs `pnpm af:evals-gate` (replay suite + lint + split present). Done when it prints `Closed "evals"`.

## Rules from practice

Sources and checks: [references/practices.md](references/practices.md). Start small with real cases (EV-01); deterministic graders before judges (EV-02); rubric-based judges (EV-03); grade end state, not exact paths (EV-04); review transcripts by hand each cycle and log new failure modes as cases (EV-05); track tool calls, tokens and errors per case (EV-06); report both pass@k and pass^k for high-risk cases (EV-07); block merges on regression (EV-08); keep a holdout (EV-09); swap models only after side-by-side evals (EV-10).
