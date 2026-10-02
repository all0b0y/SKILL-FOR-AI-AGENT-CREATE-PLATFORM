# Reference applications

The template includes three explicit **reference profiles**, not a claim that every agent needs all support tools. Choose `AF_REFERENCE=support|researcher|background` before starting the web process. Start a new conversation after changing it. The reference is persisted on the conversation and run; a different worker environment cannot reinterpret a queued run. A conversation cannot switch reference mid-history.

| Reference | Product/job | Capabilities | Deliberate omissions |
|---|---|---|---|
| `support` | Answer policies and create a confirmed support ticket | KB lookup, confirmed ticket creation, confirmed remembering/forgetting | No external ticket vendor or account system: tickets are local rows; see [TICKET_ADAPTER.md](TICKET_ADAPTER.md) for the future vendor contract |
| `researcher` | Compare the supplied documents and cite source passages | Read-only hybrid KB lookup, source comparison, uncertainty/abstention | No live web browser, external search, support writes, durable user facts or MCP |
| `background` | Produce a scheduled evidence digest from that corpus | The same read-only source access, durable pg-boss scheduling, stored results and SSE inspection | No email/message delivery, support writes, user-fact access or MCP |

The researcher is a **document-research** reference, not a web-research integration. The background reference is a complete scheduled document-digest job, not a damaged-order support run with a cron label. Both use distinct system prompts and UI copy. Their mock models are deterministic transport/lifecycle fixtures, not proof of language-model reasoning or source entailment. The built-in corpus contains example store policies; replace it with the user's actual authorized documents when generating a product.

## Run locally

Use a disposable development database, install dependencies and apply migrations as described in `OPERATIONS.md`. With the default offline mock:

```bash
pnpm kb:ingest
AF_REFERENCE=researcher pnpm dev
# Run the worker separately with the same database; reference identity lives on the run.
pnpm worker
```

For a scheduled digest, enable `AF_ENABLE_CRON=1` explicitly and submit a schedule via the operator-only CLI. `scripts/fixtures/background-smoke.json` demonstrates the complete payload including `reference: "background"`, ownership, timezone and question. Do not install this every-minute fixture on a production database. Worker startup never creates schedules. Use `pnpm cron remove <name>` to disable future occurrences; cancellation of an already queued/running occurrence is a separate operation.

Results appear in run history and the normal owner-authorized run/SSE routes. No reference silently sends a digest elsewhere. Cross-reference continuation returns a conflict; start a fresh conversation instead. A repeated occurrence ID does not create another run. A later occurrence is a separate digest.

## Offline acceptance

```bash
AF_ALLOW_TEST_DB_RESET=1 pnpm test:references
pnpm test:compose
```

The first command resets test tables, checks both read-only references against the database (tools, citations, absence of ticket/fact writes, persisted identity, deduplication, cross-profile conflicts), re-ingests the corpus, builds the app and drives all three references in desktop and mobile Chromium. Browser checks include reload, citations, reference copy, overflow and axe. It saves `.agent-forge/reference-checks.json` and per-profile screenshots under `test-results/references-*`.

Compose acceptance uses a fresh temporary database and actual container worker. It exercises both the confirmed support workflow and a **separate background digest triggered by real cron delivery**, then removes its own containers and volumes. It explicitly disables paid providers. Existing development containers/volumes are not removed.

## Boundaries

These references share the durable runtime, identity seam, tables and UI components so operational fixes do not fork. A generated product still specializes its tools, schema and UI during architect/build; a reference switch is not a substitute for the grill or for deleting unused domain features. Real-model behavioral evaluation, approved user cases and production corpus retrieval calibration remain release acceptance work and require explicit spending authorization.
