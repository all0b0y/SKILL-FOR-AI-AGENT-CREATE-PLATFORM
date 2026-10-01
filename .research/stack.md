# agent-forge stack verification (as of 2026-10-01)

Versions confirmed via `npm view <pkg> version` (registry, live) + vendor docs. "Current docs" = the unversioned (latest) docs tree at ai-sdk.dev/docs/... which reflects AI SDK 7 GA (June 25, 2026). Where sources conflicted I checked npm `time`/`dist-tags` to find the actual latest and flagged the discrepancy.

## 1. Vercel AI SDK — core (`ai`)

- **Latest**: `ai@7.0.126` (npm, published 2026-09-30). AI SDK 7 reached GA 2026-06-25. Older majors `5.x` and `6.x` are still receiving patches in parallel (e.g. `6.0.299`, `5.0.271` same day) — make sure lockfiles pin `ai@^7`, not a transitively-resolved 5/6.
  Source: npm registry, https://github.com/vercel/ai/releases
- Provider packages: `@ai-sdk/openai@4.0.83`, `@ai-sdk/anthropic@4.0.71`, `@ai-sdk/react@4.0.129` (peer: `react ^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`). Provider package majors do **not** track the core `ai` major — don't assume `@ai-sdk/openai@7` exists.
- **Zod**: `ai@7` peer-depends on `"zod": "^3.25.76 || ^4.1.8"`. Use zod v4 (latest `4.6.5`); v3 still accepted. Source: `npm view ai peerDependencies`.

### Breaking-change pitfalls vs older training data
1. **`tool({ parameters: ... })` is gone.** Current `tool()` signature uses `inputSchema` (Zod or JSON Schema), not `parameters`. Also added: `outputSchema`, `contextSchema`, `inputExamples`, `strict`. Source: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool
2. **Tool approval moved off the tool.** `needsApproval` on `tool()` is now **deprecated** — "configure approval with `toolApproval` instead... Existing `needsApproval` usages still work as a compatibility fallback." `toolApproval` is now a setting on `generateText`/`streamText`/`ToolLoopAgent`, not the tool definition, and supports per-tool map, per-tool function, or a single policy function across all tools, resolving to `'not-applicable' | 'approved' | 'denied' | 'user-approval'`. Source: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool (official, current). A community skill doc (laguagu/claude-code-nextjs-skills) corroborates this and additionally documents `experimental_toolApprovalSecret` for signing approvals server-side so a tampered client can't forge an approval. Several AI SDK cookbook/Vercel pages (dreaming.press, vibeready.sh, ai-sdk.dev/resources/recipes) still show the **older `needsApproval: true` tool-level flag** — that still runs (compat fallback) but is not the recommended v7 path. **Generate new code against `toolApproval`, treat `needsApproval` as legacy.**
3. **Agent class renamed and stabilized**: `Experimental_Agent` (v5) → `ToolLoopAgent` (v6+, now stable/production). Default stop condition is `isStepCount(20)` (not 1, not unlimited). A second class, `WorkflowAgent`, has no default step limit. Source: https://ai-sdk.dev/docs/agents/loop-control
4. **Stop-condition name drift**: current canonical docs (`/docs/agents/loop-control`) use `isStepCount()`, `hasToolCall()`, `isLoopFinished()`. Older/parallel docs (`v5` tree, and even some "AI SDK 7" marketing pages on vercel.com/docs) still show `stepCountIs()`. Both names appear to resolve in practice but **this is unverified** from registry alone — treat `stepCountIs` as the AI SDK 5/6-era name and prefer `isStepCount` for new code; test both are exported before relying on either in generated code.
5. **MCP client moved to its own package.** The MCP client is no longer `experimental_createMCPClient` from `"ai"`; it is `createMCPClient` (non-experimental) from **`@ai-sdk/mcp`** (`@ai-sdk/mcp@2.0.65` on npm, confirmed). The old `experimental_createMCPClient` from `"ai"` is the v4/v5-era import path — don't generate it for new v7 code. HTTP (Streamable HTTP) transport is the recommended production transport; stdio is local-dev only. Sources: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools, https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client, https://vercel.com/docs/mcp/integrations/ai-sdk
6. **Telemetry moved to a callback-based API in v7 GA.** `experimental_telemetry: { isEnabled: true }` is the v4/v5/v6 mechanism (still the one shown on most third-party integration docs — Gentrace, Agenta, and the ai-sdk.dev `/v4` and `/v5` versioned telemetry pages). The AI SDK 7 GA path, per Langfuse's own 2026-06-26 changelog and npm README for `@langfuse/vercel-ai-sdk`, is: call `registerTelemetry(integration)` once at startup (from `"ai"`), and pass `telemetry: { functionId, includeRuntimeContext }` per call — `runtimeContext` is excluded from spans unless explicitly included. **Unverified**: whether `experimental_telemetry` still works as a compatibility fallback under `ai@7` the way `needsApproval` does — our sources didn't state this explicitly either way. Don't assume it silently still works; verify against the installed `ai@7` type defs before shipping.
   Sources: https://langfuse.com/changelog/2026-06-26-vercel-ai-sdk-7, https://www.npmjs.com/package/@langfuse/vercel-ai-sdk, https://ai-sdk.dev/v4/docs/ai-sdk-core/telemetry (legacy reference)

### Agent loop with an approval-gated tool (current, v7-style)

```ts
// deps: ai@^7, @ai-sdk/anthropic@^4, zod@^4 — package.json must be "type": "module" (ESM-only)
import { ToolLoopAgent, isStepCount, tool } from 'ai';
import type { ModelMessage, ToolApprovalResponse } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const refund = tool({
  description: 'Refund a customer for an order',
  inputSchema: z.object({
    orderId: z.string(),
    amountCents: z.number().int(),
  }),
  execute: async ({ orderId, amountCents }) => {
    // ...call payments API...
    return { refunded: true, orderId, amountCents };
  },
});

const agent = new ToolLoopAgent({
  model: anthropic('claude-sonnet-4.5'), // use the provider's current model id
  instructions: 'You are a support agent. If a refund is denied, explain why and stop.',
  tools: { refund },
  stopWhen: isStepCount(20), // ToolLoopAgent default; override if needed
  // Approval policy lives on the agent, not the tool:
  toolApproval: {
    refund: async ({ amountCents }) => (amountCents > 5000 ? 'user-approval' : undefined),
  },
});

const messages: ModelMessage[] = [
  { role: 'user', content: 'Refund order A-1007 for $80, it arrived broken.' },
];

let result = await agent.generate({ messages });
messages.push(...result.response.messages);

const approvals: ToolApprovalResponse[] = [];
for (const part of result.content) {
  if (part.type === 'tool-approval-request') {
    const approved = await askHuman(part.toolCall); // Slack/dashboard/etc.
    approvals.push({
      type: 'tool-approval-response',
      approvalId: part.approvalId,
      approved,
      reason: approved ? 'verified' : 'denied by reviewer',
    });
  }
}

if (approvals.length) {
  messages.push({ role: 'tool', content: approvals });
  result = await agent.generate({ messages }); // approved tools execute now
}
```

Client side (`useChat`), wiring approve/deny buttons:

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';

const { messages, addToolApprovalResponse, sendMessage } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});

// render, for a part with state 'approval-requested':
// <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}>Approve</button>
```

Sources: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool, https://ai-sdk.dev/docs/agents/loop-control, https://ai-sdk.dev/docs/resources/recipes/next/human-in-the-loop (pattern shape, update tool-level `needsApproval` to agent-level `toolApproval` per point 2 above), community skill note (laguagu/claude-code-nextjs-skills, `hitl.md`) for the `toolApproval` v7 shape.

### MCP client (current package)

```ts
import { createMCPClient } from '@ai-sdk/mcp';
import { generateText, isStepCount } from 'ai';

const client = await createMCPClient({
  transport: {
    type: 'http', // Streamable HTTP — recommended for production
    url: process.env.MCP_SERVER_URL!,
    headers: { Authorization: `Bearer ${process.env.MCP_SERVER_TOKEN}` },
  },
});

try {
  const tools = await client.tools(); // MCP tools auto-converted to AI SDK tools
  const result = await generateText({
    model: 'anthropic/claude-opus-5',
    tools,
    prompt: 'Use roll_dice to roll a six-sided die once.',
    stopWhen: isStepCount(5),
  });
  console.log(result.text);
} finally {
  await client.close(); // always close, even on error
}
```

Stdio transport (`Experimental_StdioMCPTransport` from `@ai-sdk/mcp/mcp-stdio`, or `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`) is local-dev only — do not deploy it. `@modelcontextprotocol/sdk` latest is `1.31.0`.
Sources: https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools, https://vercel.com/docs/mcp/integrations/ai-sdk

### `useChat` streaming (current transport API)

- `useChat` from `@ai-sdk/react` is transport-based since AI SDK 5; it no longer manages `input` state internally (you manage your own `input` state and call `sendMessage({ text })`).
- Default transport: `new DefaultChatTransport({ api: '/api/chat' })`. There is also `DirectChatTransport({ agent })` to call a `ToolLoopAgent`/`WorkflowAgent`'s `.stream()` in-process without an HTTP hop (no reconnection support).
- Server side returns `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`, with `convertToModelMessages(messages)` converting incoming `UIMessage[]` to `ModelMessage[]`.
Sources: https://ai-sdk.dev/docs/ai-sdk-ui/transport, https://ai-sdk.dev/docs/ai-sdk-ui/chatbot, https://ai-sdk.dev/docs/reference/ai-sdk-ui/direct-chat-transport

### AI Elements (UI component registry — yes, Vercel publishes this)

- Not an npm UI library in the traditional sense: it's a **shadcn-style component registry**. Install via `npx ai-elements@latest` (adds all) or `npx ai-elements@latest add <component>`, or via the shadcn CLI directly: `npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/all.json`. Components are copied as source into `components/ai-elements/` — you own and edit them, no runtime npm dependency to version-pin.
- 45+ components as of 2026: `Conversation`, `Message`, `PromptInput`, `Response`, `CodeBlock`, `Reasoning`, `Tool`/`ToolCall`, `Agent`, `Plan`, `ChainOfThought`, `Task`, `Terminal`, `FileTree`, `Canvas`, `WebPreview`, etc. Requires shadcn/ui initialized, Tailwind CSS Variables mode, Next.js + AI SDK installed.
Sources: https://github.com/vercel/ai-elements, https://openapps.pro/packages/ai-elements

## 2. Next.js App Router

- Latest stable: `next@16.3.8` (npm `latest` dist-tag), `15.5.27` LTS line still maintained in parallel, `16.4.0-canary.x` in flight. `eslint-config-next@16.3.8` matches.
- **`next lint` is removed in Next.js 16.** The `eslint` key in `next.config.js` is also gone. `next build` no longer runs linting as a side effect. Use ESLint or Biome directly; a codemod exists: `npx @next/codemod@canary next-lint-to-eslint-cli .`. `create-next-app` now prompts for ESLint vs Biome vs none.
- `@next/eslint-plugin-next` now defaults to ESLint **flat config**, aligned with ESLint v10 dropping legacy `.eslintrc` support.
Sources: https://nextjs.org/blog/next-16, https://nextjs.org/docs/app/api-reference/config/eslint, https://github.com/vercel/next.js/pull/82266

## 3. Tailwind CSS + shadcn/ui + Motion

- `tailwindcss@4.3.3` (stable `latest`; `4.0.0` is the `next` tag, `3.4.19` is the `v3-lts` tag — stay on the `4.x` line, CSS-first config via `@theme` in CSS, no more `tailwind.config.js` required for most setups, uses `@tailwindcss/postcss` or the Vite plugin).
- `shadcn@4.21.1` — note the CLI package renamed from `shadcn-ui` to `shadcn` a while back; `npx shadcn@latest add ...` is current.
- `motion@13.5.0` is current (formerly `framer-motion`; the package is now published as `motion`, with `framer-motion` kept as a legacy alias). Confirmed via `npm view motion dist-tags`.

## 4. Postgres + Drizzle ORM + pgvector (hybrid search)

- `drizzle-orm@0.45.3` is the `latest` dist-tag; there is an active `1.0.0-rc.5` prerelease line (dist-tags `rc`, `rc5`) — **do not** generate code against `1.0.0-rc.*` syntax for a production app yet; target `0.45.x`. `drizzle-kit@0.31.11`.
- **pgvector column type is native in Drizzle** (no `customType` workaround needed on modern drizzle-orm): `vector('embedding', { dimensions: N })` from `drizzle-orm/pg-core`. (Older blog posts showing a hand-rolled `customType` vector wrapper predate this and are unnecessary now — flag as outdated if seen in training data.)
- HNSW index syntax:
```ts
import { pgTable, serial, text, vector, index } from 'drizzle-orm/pg-core';

export const embeddings = pgTable('embeddings', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
}, (table) => [
  index('embedding_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops'))
    .with({ m: 16, ef_construction: 64 }), // build params are version-sensitive; verify generated SQL
]);
```
  Operator classes: `vector_l2_ops`, `vector_ip_ops`, `vector_cosine_ops` — must match the distance operator used in queries (`<->`, `<#>`, `<=>`) or the index is ignored.
- kNN query with Drizzle's distance helpers (imported from `drizzle-orm`, not `pg-core`):
```ts
import { sql, desc, gt } from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm';
import { db } from './db';
import { embeddings } from './schema';

const queryEmbedding: number[] = await embed(query); // your embedding call

const similarity = sql<number>`1 - (${cosineDistance(embeddings.embedding, queryEmbedding)})`;

const results = await db
  .select({ id: embeddings.id, content: embeddings.content, similarity })
  .from(embeddings)
  .where(gt(similarity, 0.3))
  .orderBy(desc(similarity))
  .limit(10);
```
- **`CREATE EXTENSION IF NOT EXISTS vector;` is not auto-generated by `drizzle-kit`** — add it manually as the first line of a migration.
- **Hybrid search (vector + Postgres full-text)**: Drizzle has no native `tsvector` column type; use `customType` (or a `.generatedAlwaysAs()` generated column on modern Postgres) with a GIN index, then combine ranking in one query (e.g. weighted sum of `ts_rank`/`cosineDistance`, or two queries unioned/re-ranked in app code):
```ts
import { SQL, sql, customType, index, pgTable, serial, text } from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType() { return 'tsvector'; } });

export const docs = pgTable('docs', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  bodySearch: tsvector('body_search')
    .notNull()
    .generatedAlwaysAs((): SQL => sql`to_tsvector('english', ${docs.body})`),
}, (t) => [index('idx_body_search').using('gin', t.bodySearch)]);

// query: sql`${docs.bodySearch} @@ to_tsquery('english', ${term})`
```
Sources: https://orm.drizzle.team/docs/extensions/pg, https://mintlify.wiki/drizzle-team/drizzle-orm/schema/indexes, https://orm.drizzle.team/docs/guides/postgresql-full-text-search, https://orm.drizzle.team/docs/guides/full-text-search-with-generated-columns

### pgvector Docker image

Current pgvector release is **0.8.6**. Tag pattern: `pgvector/pgvector:0.8.6-pg18` (or `pg17`/`pg16`/etc., `-bookworm`/`-trixie` Debian variants). **Pin the exact version tag** (`0.8.6-pg17`, not floating `pg17`) — the pgvector index file format has shifted across minor versions and an unpinned upgrade can force an unexpected HNSW rebuild.
```yaml
services:
  db:
    image: pgvector/pgvector:0.8.6-pg17
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```
Sources: https://github.com/pgvector/pgvector, https://hub.docker.com/r/pgvector/pgvector/tags

## 5. Postgres-backed job queue — decision: **pg-boss**

- `pg-boss@12.35.1` (current), `graphile-worker@0.18.0` (still pre-1.0 after years; versioning is a minor maturity flag).
- Both are production-quality Postgres `SKIP LOCKED` queues with `LISTEN/NOTIFY` low-latency wakeup. Chose **pg-boss** because:
  1. It ships **first-party transactional adapters for Drizzle, Knex, Kysely, Prisma** — a job can be enqueued inside the same Drizzle transaction as the business write, which graphile-worker doesn't offer as directly.
  2. Richer built-in feature set matching our needs: cron **and** RRULE schedules, delayed jobs, priorities, **dead-letter queues with redrive**, rate limiting/debouncing via queue policies, pub/sub fan-out, simple job-dependency workflows.
  3. Runs on vanilla Postgres plus CockroachDB/YugabyteDB/Citus/embedded PGlite — more deployment flexibility if we outgrow a single Postgres primary.
  4. graphile-worker's edge (SQL-triggerable `add_job()`, slightly lower per-message latency, tighter Graphile/PostGraphile ecosystem fit) doesn't apply — we're not on PostGraphile.
- Tradeoff accepted: pg-boss is JS/Node-only for the worker API (acceptable, our worker is Node); very high job rates (>5–10k/s sustained) would need migration to a real broker, far above our expected load.
Sources: https://github.com/timgit/pg-boss, https://faun.dev/toolbox/graphile-worker-vs-pg-boss/, https://www.bigiron.cc/guides/the-postgres-as-a-message-queue-pattern-when-its-fine-when-its-not

Minimal shape (API is stable across the 9.x–12.x line; verify exact method names against the installed `12.35.x` typings before generating a full worker):
```ts
import PgBoss from 'pg-boss';
const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue('send-email');
await boss.send('send-email', { to: 'a@b.com' });
await boss.work('send-email', async ([job]) => {
  // process job.data
});
```
This snippet is **unverified against the exact 12.x API surface** (not pulled from live docs this pass) — confirm method signatures (`send` vs `publish`, `work` vs `subscribe`, queue-creation requirement) against the installed package's TypeScript types before shipping.

## 6. Observability: OpenTelemetry + optional Langfuse

- `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.222.0` (0.x — OTel JS SDK is still pre-1.0 for Node; expect continued minor churn).
- Langfuse: `langfuse@3.39.2` is the **legacy** SDK; for AI SDK 7, Langfuse ships a dedicated package **`@langfuse/vercel-ai-sdk`** (confirmed targets AI SDK v7, requires Node 22+) plus `@langfuse/otel` (`LangfuseSpanProcessor`) and `@langfuse/tracing`. See telemetry pitfall #6 above for the `registerTelemetry` + `telemetry:{...}` wiring — this supersedes the older `experimental_telemetry: { isEnabled: true }` + manual `NodeTracerProvider` pattern (which remains documented for AI SDK ≤6 and is what most non-Langfuse-specific blog posts still show).
Sources: https://langfuse.com/docs/integrations/vercel-ai-sdk, https://www.npmjs.com/package/@langfuse/vercel-ai-sdk, https://langfuse.com/changelog/2026-06-26-vercel-ai-sdk-7

## 7. Lint/format: decision — **Biome**

- `@biomejs/biome@2.5.15` vs `eslint@10.11.0` + `prettier@3.9.9` (+ `eslint-config-next@16.3.8`).
- Chose **Biome** because: (a) Next.js 16 removed `next lint` entirely and `create-next-app` now offers Biome as a first-class alternative with generated Next.js/React domain rules baked in; (b) one tool for lint+format removes Prettier/ESLint config drift and is materially faster; (c) ESLint v10 forces flat-config migration anyway, so there's no "stay simple" argument for keeping ESLint.
- Caveat: Biome's Next.js-specific rule coverage is narrower than `eslint-config-next` (per Next.js's own PR description: "Biome (fast with fewer rules)"). If the generated app needs the full `eslint-plugin-react-hooks`/`eslint-config-next` rule depth (e.g. strict React Hooks exhaustive-deps enforcement), fall back to ESLint flat config + `eslint-config-next`. Document this escape hatch in the generated project's README.
Sources: https://nextjs.org/blog/next-16, https://github.com/vercel/next.js/commit/9c1a97bf568a092d52f0faa8b6783d67de0c1166

## 8. Testing / quality tooling — versions confirmed, APIs not independently re-verified this pass

- `knip@6.39.0`, `vitest@5.0.3` (major version 5 — confirm `vitest.config.ts` syntax against v5, not v1-era docs training data may know), `fast-check@4.10.2`, `@playwright/test@1.63.0`, `@axe-core/playwright@4.13.0`, `@lhci/cli@0.15.1` (Lighthouse CI, pre-1.0).
- **Unverified**: I did not get live doc confirmation this pass of vitest 5's exact breaking changes vs vitest 1–3 (web search for this returned no usable results — Firecrawl backend was rate-limited/403 for several queries). Before generating vitest config/bench code, check `vitest@5` changelog directly (workspace config format and `vitest bench` API are the two things most likely to have moved across major versions).
- `@vitest/bench` as a separate package **does not exist on npm** (`npm view` returned N/A) — benchmarking is `vitest bench` / the `bench()` API exported from `vitest` itself, not a separate package. Don't generate a `@vitest/bench` dependency.

## 9. Docker Compose, package manager

- Use `pgvector/pgvector:0.8.6-pg17` (or `pg18` if targeting newest Postgre) pinned by digest/tag, per §4.
- **pnpm vs npm: decision — pnpm** (`pnpm@12.8.1` current). Reasons: content-addressable store (faster installs, less disk), strict `node_modules` resolution by default (catches phantom/undeclared dependencies that `npm` would silently allow — important for a generated codebase meant to be a clean reference), native workspaces for a plugin that may scaffold a monorepo (web app + worker package), and it's the package manager Next.js/Vercel docs default to in their own examples. `npm@12.x` has closed much of the speed gap but still lacks pnpm's strict linking.

## Summary of explicit "unverified" items
- Whether `experimental_telemetry` still functions as a silent compatibility fallback under `ai@7` (unlike `needsApproval`, no source explicitly confirmed/denied this).
- Whether `stepCountIs` (vs `isStepCount`) is still exported/working in `ai@7`, or is purely legacy naming from v5/v6 docs bleeding into marketing pages.
- Exact pg-boss 12.x method names/signatures (`send`/`work` shown here are representative, not re-verified live against 12.35.1 typings this pass).
- vitest 5.x precise breaking changes vs older majors (web search failed on this query this pass; not independently confirmed).
- Drizzle HNSW `.with({ m, ef_construction })` build-parameter syntax: documented in one secondary source as "version-dependent, visually confirm generated DDL" — not confirmed against the official orm.drizzle.team page directly.

## 10. Local verification against installed typings (2026-10-01, orchestrator)

Installed in a scratch dir: `ai@7.0.126`, `@ai-sdk/mcp@2.0.65`, `@ai-sdk/react@4.0.129`, `pg-boss@12.35.1`, `drizzle-orm@0.45.3`, `vitest@5.0.3`, `zod@4.6.5`. Resolved the "unverified" items:

- `isStepCount` is canonical; `stepCountIs` is still exported as an alias (`isStepCount as stepCountIs`). Generate `isStepCount`.
- `ToolLoopAgent` is canonical (`Experimental_Agent` is an alias). Default stop: `isStepCount(20)`.
- `toolApproval` exists on `generateText`, `streamText`, `ToolLoopAgent`; status type `undefined | 'not-applicable' | 'approved' | 'denied' | 'user-approval'`. Tool-level `needsApproval` still honoured (compat).
- `experimental_toolApprovalSecret?: string | Uint8Array` exists on all three — use it so clients cannot forge approvals.
- `experimental_telemetry` is `@deprecated Use telemetry instead`; still accepted. Generate `telemetry: {...}` + `registerTelemetry(...integrations)`.
- **pg-boss uses a NAMED export**: `import { PgBoss } from 'pg-boss'` (the default-import snippet in §5 is wrong). API: `start()`, `stop()`, `createQueue(name, opts)`, `send(name, data, opts)` → id, `work(name, [opts], handler)`, `schedule(name, cron, data, opts)`, `cancel(name, id)`. `singletonKey` gives dedupe (webhook idempotency). Transaction adapters `fromDrizzle` etc. are exported.
- Drizzle `IndexBuilder.with(obj: Record<string, any>)` exists → HNSW `.with({ m: 16, ef_construction: 64 })` typechecks.
