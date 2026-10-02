# Reference implementation contract

This describes the shipped **offline reference**, not a user-approved product interview. `REFERENCES.md` defines the three concrete scenarios. A generated product must use its approved `.agent-forge/AGENT_SPEC.md` and `.agent-forge/ARCHITECTURE.md`, change the API inventory scope to `product`, and remap/remove modules rather than inherit unnecessary features.

## case

Support answers store-policy questions from the bundled documents and escalates only after confirmation. Researcher compares those documents read-only. Background produces a scheduled, cited digest. None of these fixtures establishes production model quality or an external ticket-vendor integration.

## users

Chat users own conversations, messages and runs. Operators inspect metadata and configure schedules. The reference has chat, webhook and cron entry points; webhook and cron deliveries carry durable deduplication keys. A persisted conversation reference controls its capabilities, not the next worker's default environment.

## tools

Support exposes `kb_search` (read), `ticket_create` (write), `remember` (write), and `forget` (destructive). Researcher/background expose only their read-only retrieval capability. Every write/destructive operation requires human approval. Tool inputs are schema-validated; outputs use a shared structured error contract; limits, retry policy, operation identity and structured errors are shared with explicitly configured MCP tools. No arbitrary shell, browser or generic HTTP tool is enabled by default.

## autonomy

Use a bounded single-agent loop, not an orchestrator. Runs persist queued/running/awaiting-approval/done/failed/cancelled status. Approval releases the worker; resumption preserves operation identity. Cancellation prevents subsequent calls but does not claim to undo an in-flight external action. A repair to model-visible interrupted history must preserve original transcript rows and cannot invent a successful side effect.

## memory

Postgres stores original messages, incremental summaries, document chunks and optional confirmed user facts. Retrieval combines indexed lexical and vector candidates. Hash embeddings are an explicit offline baseline, never a semantic-quality claim. Semantic embeddings require explicit provider configuration and paid consent. Budget reservation and persistence must prevent concurrent overspending; failed ingestion must not replace the old knowledge base partially.

## budget

Run steps, cost, failures and context size have explicit ceilings. Model selection is explicit, pricing must be known, and there is no silent provider fallback. Offline evals use mock responses and recorded cassettes. Paid model/embedding work requires consent and bounded spend; an empty or failed benchmark cannot select a winning model.

## risks

Treat retrieved/user/tool content as untrusted data. Preserve the distinction between requested and approved actions. Validate identity before reading owned state, validate arguments at boundaries, and keep conversation text/secrets out of traces by default. Adversarial fixtures test plumbing only; real-model robustness is separate acceptance.

## deployment

Next serves the UI/HTTP interface; a separate pg-boss worker runs durable work against Postgres. Local binding and identity are defaults, not public authentication. Public operation requires a protected identity adapter; HMAC covers identity and roles. The database schema, migrations, indexes and queue publication must preserve durability and isolation. Installation does not silently create schedules.

## ui

Show incremental text, tool state, exact approval payloads, cost/steps, stopping and recoverable failures. Keep stable delivery identity across uncertain network outcomes; reconnect SSE without duplicating text. Restore owned history after reload and expose a link from a run to its conversation. Use semantic theme tokens, responsive layouts, keyboard access, reduced-motion handling and accessible state announcements.

## evals

Use typed/versioned prompts with retained provenance, explicit profile-selected cases and deterministic record/replay. Separate dev and holdout cases. The shipped cases are synthetic, not approved user evidence. Offline tests cover concurrency, ownership, approval, interrupted history, retrieval plumbing, browser recovery and performance ceilings. Paid judges, semantic quality, model selection and plugin pressure tests require their own acceptance.
