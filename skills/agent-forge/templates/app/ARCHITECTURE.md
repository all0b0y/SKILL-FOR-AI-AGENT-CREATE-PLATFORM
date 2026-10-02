# Support reference architecture

This is the shipped reference, not approval of a new product. The build phase replaces this with the application's agreed `.agent-forge/ARCHITECTURE.md` and changes the registry to match.

## boundaries

Browser components depend only on presentation modules and the HTTP run API. Server routes resolve identity and call the run service. The run service persists messages and enqueues pg-boss in the same database transaction. The independent worker invokes the agent loop. Tools own retrieval and side effects; provider selection is explicit and never falls back silently.

## tools

| tool | risk | scenario |
|---|---|---|
| kb_search | read | answer store policy questions from cited articles |
| ticket_create | write | escalate an unresolved customer problem after approval |
| remember | write | save an approved non-sensitive customer preference |
| forget | destructive | remove an unwanted or outdated customer preference on request |

No web browsing, shell, filesystem access, MCP, arbitrary HTTP or email tools are enabled in this support reference: its scenarios do not require them. Add tools only after the specification justifies them.

## durability

Concurrent deliveries are serialized by idempotency key; conversation appends are serialized and reject active runs. Approval decisions and cancellation share a per-run transaction lock. Queue publication commits atomically with the state transition using the pg-boss Drizzle adapter. Native ticket/fact IDs derive from user/run/call, so a crash between a database write and its acknowledgement cannot duplicate that write. An external adapter must pass the same operation key to the provider or implement reconciliation; a local output cache alone is not exactly-once delivery.

The browser stores only a conversation identifier in the URL. Refresh reconstructs owned questions from Postgres and answers/approval state from SSE replay. Terminal status retires pending approval controls. Before a later user turn, the model-only history projection closes interrupted tool calls with an explicit unknown-outcome error; it never reauthorizes historical approvals or rewrites source rows. Cancellation cannot undo an already-running external operation; it prevents subsequent calls and leaves the run cancelled.

## complexity

- Retrieval: two indexed candidate queries plus one batch hydration query, bounded by candidate count; RRF is O(n log n) time and O(n) memory.
- Context selection: O(m) over message history, preserving tool-response adjacency. Discarded-prefix messages are summarized incrementally through the configured model, in bounded batches; the versioned summary stores a durable message cursor. Source rows are retained. Summary calls consume the same step/cost budget and have a bounded output. The offline mock emits explicitly labelled source excerpts, not a semantic-quality result.
- SSE uses indexed `(run_id, seq)` lookup. The immutable browser reducer copies the current blocks/tools, so its cost is O(blocks + tools) per event, not O(1).
- Startup/approval locks cover one delivery/conversation/run, not a global application mutex.

## implementation-map

`api-contract.json` maps every `src` module and its exact exported names to specification and architecture sections. `pnpm architecture` rejects unmapped/missing modules, export drift, absent anchors and missing descriptive TSDoc, in addition to runtime import boundaries/cycles and tool-risk parity. The shipped scope is `reference`, using `REFERENCE_SPEC.md`; when a product spec exists, both approved product documents and `scope: "product"` are required. Update mappings deliberately; the checker never generates or approves them automatically.

This is structural traceability, not a proof that implementation behavior satisfies prose. Behavioral tests and human review remain necessary; a short comment or a valid section link alone is not acceptance.

## limitations

The bundled mock model and 256-dimensional hash embedder validate plumbing, not real semantic quality. Production model and embedding quality need explicit, paid acceptance. The three profiles have separate offline runtime/browser/replay checks; see REFERENCES.md. These do not establish live-model quality. Trace content is off by default; run transcripts remain application data and require an operator retention policy.
