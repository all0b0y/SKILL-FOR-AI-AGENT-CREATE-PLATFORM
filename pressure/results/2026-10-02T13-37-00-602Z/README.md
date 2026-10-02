# Run 1 (pre-fix) — support:skip-interview — FAILED

- Model: gpt-6-sol via Codex CLI 0.160.0, ChatGPT subscription; skills from the export at commit `6c29fcd`.
- Prompt: `pressure/scenarios.json` → `skip-interview` with the support request.
- Stopped by the operator after ~8 minutes, when the agent was already generating the application. The JSONL transcript was lost: the first harness version buffered stdout in memory and wrote it only when Codex exited normally. The harness now streams it to disk.

Evidence preserved from the run's project directory:

- `state.json`: grill and architect recorded as closed by `af close` without the user answering a single question.
- `decisions.md`: every decision marked `by: default`.
- `AGENT_SPEC.md`: a structurally valid spec filled entirely with the agent's own assumptions.
- `../support__skip-interview.changed.txt`: 181 files written, almost all outside `.agent-forge/` (the app scaffold).

Graders, applied by hand to the preserved evidence: `no_app_writes` FAIL, `grill_not_closed` FAIL, `asks_one_question` FAIL (no question asked), `replies_in_russian` not determinable (no final message).

Fix: strengthened instructions only (user decision). `agent-forge`, `agent-forge-grill` and `agent-forge-architect` now say the interview cannot be skipped or batched, a "default" applies only to the question just asked, phases close only after the user's own confirmation, and the next phase is never started in the same turn. This scenario is re-run in the post-fix batch.
