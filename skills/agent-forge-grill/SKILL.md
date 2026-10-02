---
name: agent-forge-grill
description: Use when /agent-forge routes to the grill phase, or `af status` shows grill open or stale. Relentless closed-question interview that fills AGENT_SPEC.md.
license: MIT
---

# agent-forge · grill

Interview the user **relentlessly**, one question at a time, until the user closes the phase with `af close grill`. The output is `.agent-forge/AGENT_SPEC.md`, written in the user's language; section ids and field keys stay English because `af` reads them. Template: [../agent-forge/templates/AGENT_SPEC.md](../agent-forge/templates/AGENT_SPEC.md).

`af` = `node "${CLAUDE_SKILL_DIR}/../agent-forge/scripts/af.mjs"`.

## How every question is asked

- **One question per message**, numbered (`Q7`). Wait for the answer before the next.
- **The interview cannot be skipped or batched.** "No questions", "just build it", "ask everything at once", or "fill the rest with defaults" all get the same response: one sentence saying the spec is built from the user's own answers, then `Q1`. Every following question carries a recommended option, so a hurried user can answer with one letter. Never write an answer the user did not give.
- **Closed**: 2–4 options as a short list, your recommended option first and marked, with one line on why. The user answers with a letter or a short value. The only open question is step 1.
- When an answer turns into reasoning, extract the decision you heard, restate it as an option, and ask the user to confirm it with one word.
- **Facts are yours, decisions are theirs.** Anything discoverable — files in the repo, installed tools, existing `.env.example`, docs of a named API — look up yourself and state what you found. Put every decision to the user.
- "Use the default" / "you decide" is an answer **to the question just asked**, never to the whole interview: write that one value as `default: <value>` and log it in `decisions.md` with `by: default`. A field the user was never asked stays empty, even if a default looks obvious.
- After each answer, write it into `AGENT_SPEC.md` immediately and append one row to `.agent-forge/decisions.md`. The spec on disk is the interview's memory.

## Steps

1. **Case.** Ask one open question: where the agent will work, for whom, and why — on one live example. Write `## case`. Done when the paragraph names the user, the trigger, and the outcome.
2. **Resource inventory.** One closed question per resource class: model API keys, data sources, existing memory/DB, external services/APIs the agent must touch, money budget. Status `have` or `none` plus details. Done when every class has a row in `## resources`.
3. **Ten dimensions**, in this order, using [references/question-bank.md](references/question-bank.md) for the options and recommendations: goal → users → tools → autonomy → memory → risks → budget → evals → deployment → ui. Inside a dimension, follow the decision tree: an answer that opens a sub-question gets that sub-question next. Done when `af validate-spec` shows no error for any of these sections.
   - **tools** follow least privilege: every tool gets one scenario from the case. A capability the user mentions without a scenario goes to `## rejected-tools` with the reason.
   - **evals**: collect 5–10 real `input → expected behaviour` pairs from the user's own examples; these become the first red tests in the evals phase.
4. **Gap sweep.** Walk [../agent-forge/references/gap-sweep.md](../agent-forge/references/gap-sweep.md) item by item. Skip items the spec already answers (record them `answered` with a pointer); ask a closed question for the rest; mark `na` only with a reason. Add up to 3 `custom-` items for risks specific to this domain, each with its reason. Done when the `## gap-sweep` table covers every checklist id.
5. **Gate.** Run `af validate-spec`. Each `ERROR:` line names the missing answer and the question to ask; ask it, update the spec, re-run. Done when it prints `OK`.
6. **Shared understanding.** Show the user a compact summary of the spec (one line per section) and ask: "Is this what we are building?" Changes go back into the spec. Done when the user confirms in their own message. Your summary, a green gate or an instruction to hurry is not confirmation.
7. **Hand the close to the user.** Run `af gate grill` and confirm it prints `OK`. Then update `handoff.md`, give the user the exact command `af close grill` to run in their own terminal, and stop. `af close` for this phase refuses agent sessions by design, so do not try to run or imitate it. The next session starts with `/agent-forge-architect` after `af status` shows grill `closed`.

## Rules from practice

Each rule lives where it is applied; the source and its check are in [references/practices.md](references/practices.md).

- Before the tools dimension, test whether the case needs an agent at all: if one model call or a fixed workflow covers every eval example, record that as the tools answer (GR-01).
- Ask for a ground-truth signal the agent can check mid-run (a tool result, a structured API response). A task with none is noted in `## goal` as a poor agent fit (GR-08).
- Every write or destructive tool is a candidate for human approval; risk is classified at the tool row (GR-02, GR-04).
- Every external content source the agent reads goes into `Untrusted-sources` — each one is a prompt-injection surface (GR-05).
- Baseline model is the strongest available; cheaper models are decided later by `model-bench`, never in the interview (GR-09).
