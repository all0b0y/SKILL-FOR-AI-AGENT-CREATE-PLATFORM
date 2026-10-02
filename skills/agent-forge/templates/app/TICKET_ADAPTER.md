# External ticket adapter (future work)

The support reference keeps tickets as **local Postgres rows** (`tickets` table, `ticket_create` in `src/agent/tools/registry.ts`). v1 ships no external ticket vendor. This document is the contract a generated product follows when its spec names a real ticket system (Zendesk, Linear, GitHub Issues, Jira and so on). Nothing here is implemented or verified against a vendor.

## When to build it

Only when `AGENT_SPEC.md` lists the ticket system under `## resources` as `have`, with a sandbox account, and its `## tools` row gives a scenario for creating external tickets. Without those, keep the local table. Do not add a vendor speculatively.

## Contract

Replace the body of `ticket_create`. Keep its name, input schema, `risk: 'write'` and approval requirement unless the spec says otherwise.

| Concern | Requirement |
| --- | --- |
| Operation identity | Derive `operationId(userId, runId, toolCallId, 'ticket')` exactly as today. Send it as the vendor's idempotency key (header or field). If the vendor has none, store it in a custom field or external-ID field and search by it before creating. |
| Retries | `retries` above 0 only when the vendor deduplicates by that key. Otherwise use 0, and on a timeout perform the reconciliation below instead of resending. |
| Unknown outcome | A timeout or connection reset after sending is **unknown**, not failed. Before reporting failure, look up the ticket by operation identity. If it exists, return it; if the vendor cannot be queried, return an explicit unknown-outcome error so the model does not claim success. |
| Local record | Keep a `tickets` row keyed by the operation identity, holding the vendor ticket ID and URL. The run timeline, owner checks and redelivery stay local, and the vendor is not polled on every view. |
| Credentials | Vendor token in `.env.local` only, read through `src/env.ts` with a schema entry. Never put it in prompts, spans, events or logs. Scope it to ticket creation in one project or queue. |
| Untrusted data | Vendor responses shown back to the model go through `asUntrusted` with the vendor name as source. |
| Approval payload | The approval card must show the exact vendor, queue/project, subject and body that will be sent. |
| Cancellation | Cancelling a run after the call has started cannot undo the ticket. Document that, as the native tool does. |

## Acceptance before claiming the integration

1. A contract test against a local HTTP fake that returns timeouts, duplicate-key responses, 401/403 and 5xx. Assert one ticket per operation identity and correct unknown-outcome handling.
2. A sandbox run with the user's own test account, approved separately because it touches an external service, covering create, retry after timeout and lookup.
3. `RELEASE.md` and `REFERENCES.md` updated with the vendor, the sandbox evidence and anything still unverified.
