# Operator interfaces

## Docker Compose

Configure `.env.local` from the example, then run `docker compose up --build -d`. A one-shot migration service must succeed before web and worker start, including on a fresh database. Load the bundled knowledge explicitly with `docker compose exec worker pnpm kb:ingest`. The default app and database ports are published only on host loopback; do not widen the app binding while using local identity. Back up the named Postgres volume before deployment. `docker compose down` preserves it; do not use volume pruning as a deployment step.

The manual offline deployment check is `pnpm test:compose` (see TESTING.md). Its minute-based cron fixture is installed only inside the isolated smoke project and removed afterward; normal worker startup does not register it.

## Scheduled runs

Schedules are opt-in and are never registered on worker startup. An operator with database access can manage them:

```sh
pnpm cron put path/to/schedule.json
pnpm cron list
pnpm cron remove daily-policy
```

A definition contains `name` (lowercase slug), `cron` (pg-boss cron expression), `timezone` (IANA name, default UTC), `userId` (the owning account), and `text` (the scheduled request). Treat this file as privileged configuration: choosing `userId` is an operator action, not a public API. Keep customer text out of public source control.

The worker consumes scheduled occurrences and creates normal `surface=cron` runs. Redelivery of the same occurrence is idempotent; separate occurrences create separate runs. Write/destructive tools still pause for approval. Keep the worker running; schedule execution is not provided by the web process alone. Stopping a schedule prevents future occurrences, not runs already queued.

## Saved preferences

The `remember` tool stores a small user-owned preference only after approval. Context includes its stable identifier, source run/tool call and recorded timestamp. The `forget` tool also requires approval and displays the exact preference text with its identifier; deletion matches both fields and the authenticated owner. Rejection leaves the record intact; repeating a deletion is a harmless no-op and never deletes another user's record.

For the offline mock, use `Remember: Prefers pickup`, then `Forget fact <returned-fact-id>: Prefers pickup`. These are scripted integration fixtures, not evidence of natural-language memory quality. Removing a preference excludes it from future fact retrieval; it does **not** erase source conversations, summaries, tool receipts, backups or an in-flight model context. Do not present this as account-wide erasure.

## MCP

Nothing is enabled by default. Set `AF_MCP_CONFIG` to a local JSON file with `servers` entries. Each server has an HTTPS `url` (HTTP is allowed only on loopback), optional `headersFromEnv` mapping header names to environment-variable names, and an explicit `tools` allowlist.

Each tool entry declares `name` (local snake_case alias), `remoteName` (exact server identifier), `risk`, `scenario`, and operator-authored `description`. Write/destructive entries additionally require `idempotencyArgument`: the argument the provider actually honors as an idempotency key. Do not claim this capability for a server that does not support it. The runtime injects a stable user/run/call key; writes are never automatically retried. Human approval is enforced by the same AI SDK policy as native tools.

```sh
pnpm check-tools
```

This connects and validates discovery/schema/allowlist without executing tools or calling a model. Discovery follows pagination with bounded/repeated-cursor protection. Missing configured tools and duplicate aliases fail closed. Remote descriptions do not replace the operator description; outputs are bounded, masked and marked untrusted. Do not put credentials in URLs or configuration files; reference environment variables.

## OpenTelemetry

Every instrumented span flows through the OTel SDK into the Postgres timeline. To additionally export to an OTLP/HTTP collector, set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to its complete trace endpoint (typically ending in `/v1/traces`). Standard OTel header configuration is handled by the exporter; never commit its values. No collector is contacted when the endpoint is unset.

The default metadata allowlist contains surface, finish reason, prompt hash, token counts, cost and run identifier, not conversation text or raw exception messages. `TRACE_CONTENT=1` only allows explicitly marked `content.*` attributes; it does not enable automatic provider-request capture. PII/secret masking applies before both exporters. Each run flushes and shuts down its provider.

## Identity proxy contract

The proxy signs `JSON.stringify([userId, rolesHeader])` with HMAC-SHA256 and the shared identity secret, sends the hex digest as `x-user-signature`, and sets `x-user-id` plus `x-user-roles`. An omitted roles header means the literal string `user`. The role header is part of the signature; changing it invalidates the request. Strip caller-supplied identity headers at the proxy. Do not expose the local identity adapter publicly.
