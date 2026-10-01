# Stack facts (verified 2026-10-01 against installed packages)

Versions: `next@16.3`, `react@19.2`, `ai@7.0`, `@ai-sdk/react@4.0`, `@ai-sdk/anthropic@4.0`, `@ai-sdk/mcp@2.0`, `zod@4`, `drizzle-orm@0.45` (not 1.0-rc), `drizzle-kit@0.31`, `pg-boss@12.35`, `tailwindcss@4.3`, `motion@13`, `@biomejs/biome@2.5`, `vitest@5`, `fast-check@4`, `@playwright/test@1.63`, `@axe-core/playwright@4.13`, `@lhci/cli@0.15`, `knip@6`, pnpm, Postgres image `pgvector/pgvector:0.8.6-pg17`.

## AI SDK 7

| Write | Not (older APIs) |
|---|---|
| `new ToolLoopAgent({ model, instructions, tools, stopWhen: isStepCount(n), toolApproval, telemetry })` | `Experimental_Agent`, `stepCountIs` (alias only), `maxSteps` |
| `tool({ description, inputSchema: z.object(...), execute })` | `parameters:` |
| `toolApproval: { ticket_create: 'user-approval' }` or a per-tool function returning `'user-approval' \| 'approved' \| 'denied' \| undefined` | `needsApproval` on the tool (compat only) |
| `experimental_toolApprovalSecret: process.env.APPROVAL_SECRET` so a client cannot forge approvals | trusting a client-side `approved: true` |
| result parts `type: 'tool-approval-request'` with `approvalId`, `toolCall`; answer with `{ type: 'tool-approval-response', approvalId, approved, reason }` in a `role: 'tool'` message | |
| `telemetry: { functionId }` + `registerTelemetry(...)` once at startup | `experimental_telemetry` (deprecated) |
| `createMCPClient({ transport: { type: 'http', url, headers } })` from `@ai-sdk/mcp`; `await client.tools()`; always `client.close()` | `experimental_createMCPClient` from `ai` |
| `useChat({ transport: new DefaultChatTransport({ api }) })` from `@ai-sdk/react`; manage `input` yourself; `sendMessage({ text })`; `addToolApprovalResponse({ id, approved })` | `useChat().input`, `handleSubmit` |
| Offline tests: `MockLanguageModelV4` from `ai/test` with scripted `doGenerate`/`doStream` | network calls in unit tests |

## pg-boss 12

```ts
import { PgBoss } from 'pg-boss';            // named export, not default
const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue('runs');               // queues must exist before send/work
await boss.send('runs', { runId }, { singletonKey: runId }); // singletonKey = idempotency
await boss.work('runs', async ([job]) => { /* job.data.runId */ });
await boss.schedule('nightly', '0 3 * * *', {});  // cron surface
```
Transactional enqueue with Drizzle: `fromDrizzle` adapter exported by `pg-boss`.

## Drizzle 0.45 + pgvector + full-text

```ts
import { index, pgTable, text, uuid, vector, customType } from 'drizzle-orm/pg-core';
import { cosineDistance, sql } from 'drizzle-orm';
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  body: text('body').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('simple', body)`),
}, (t) => [
  index('chunks_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  index('chunks_search_gin').using('gin', t.search),
]);
```
- `CREATE EXTENSION IF NOT EXISTS vector;` is not generated — put it first in the initial migration.
- The operator class must match the query operator (`vector_cosine_ops` ↔ `cosineDistance` / `<=>`), or the index is ignored.

## Next.js 16 / tooling

- `next lint` no longer exists: lint and format with `biome check`.
- Tailwind 4: CSS-first config with `@theme` in `globals.css`, plugin `@tailwindcss/postcss`.
- Motion: `import { motion, AnimatePresence, useReducedMotion } from 'motion/react'`.
- Benchmarks: `bench()` from `vitest` (there is no `@vitest/bench` package).
