/**
 * The agent's tools — exactly the rows of ARCHITECTURE.md `## tools`. The template ships the
 * reference support agent; the build phase replaces this list with the spec's tools.
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { facts, tickets } from '@/db/schema';
import { operationId } from '@/lib/operation-id';
import type { EmbeddingBudget } from '@/memory/embedding-provider';
import { retrieve } from '@/memory/retrieve';
import { asUntrusted } from '../guardrails';
import { defineTool, type RegisteredTool, ToolInputError } from './define';

/** Build the native support capabilities against the supplied database and optional embedding ledger. Ticket IDs may be injected only for deterministic evals; production derives idempotent operation IDs. The executor applies the persisted reference allowlist and approvals. */
export function createRegistry(
  db: Db,
  ticketId?: () => string,
  embeddingBudget?: EmbeddingBudget,
): RegisteredTool[] {
  const evalIds = new Map<string, string>();
  return [
    defineTool({
      name: 'kb_search',
      description:
        'Search the knowledge base. Use for any question about policies, delivery, returns or products. Returns up to 5 passages with their source; cite the source in the answer.',
      risk: 'read',
      scenario: 'answer from knowledge-base articles',
      input: z.object({ query: z.string().min(2).max(200).describe('Search words in the user language') }),
      timeoutMs: 8_000,
      retries: 0,
      execute: async ({ query }) => {
        const hits = await retrieve(db, query, 5, 20, undefined, embeddingBudget);
        if (hits.length === 0) return 'No passages found. Tell the user it is not in the knowledge base.';
        return hits.map((h) => asUntrusted(`kb:${h.source}`, `# ${h.title}\n${h.body}`)).join('\n\n');
      },
    }),
    defineTool({
      name: 'ticket_create',
      description:
        'Create a support ticket for a problem the knowledge base cannot solve. Requires human approval. Use once per problem.',
      risk: 'write',
      scenario: 'escalate an unresolved question',
      input: z.object({
        subject: z.string().min(5).max(120).describe('One-line summary'),
        details: z.string().min(10).max(2_000).describe('What happened, order number if known'),
      }),
      timeoutMs: 5_000,
      retries: 1,
      execute: async ({ subject, details }, ctx) => {
        const key = operationId(ctx.userId, ctx.runId, ctx.toolCallId, 'ticket');
        if (ticketId && !evalIds.has(key)) evalIds.set(key, ticketId());
        const id = evalIds.get(key) ?? key;
        await db
          .insert(tickets)
          .values({ id, userId: ctx.userId, subject, body: details })
          .onConflictDoNothing();
        const [row] = await db
          .select({ id: tickets.id, subject: tickets.subject })
          .from(tickets)
          .where(and(eq(tickets.id, id), eq(tickets.userId, ctx.userId)));
        if (!row) throw new Error('ticket unavailable');
        return { ticketId: row.id, subject: row.subject };
      },
    }),
    defineTool({
      name: 'remember',
      description:
        'Save one durable fact about the current user (e.g. preferred delivery city) for future conversations. Never store secrets or payment data.',
      risk: 'write',
      scenario: 'keep customer history across conversations',
      input: z.object({ fact: z.string().min(3).max(300) }),
      timeoutMs: 1_000,
      retries: 0,
      execute: async ({ fact }, ctx) => {
        if (/\b\d{13,19}\b/.test(fact)) {
          throw new ToolInputError(
            'looks like a card number',
            'Do not store payment data; save only non-sensitive facts.',
          );
        }
        await db
          .insert(facts)
          .values({
            id: operationId(ctx.userId, ctx.runId, ctx.toolCallId, 'fact'),
            userId: ctx.userId,
            fact,
            source: `${ctx.runId}:${ctx.toolCallId}`,
          })
          .onConflictDoNothing();
        return { saved: fact, factId: operationId(ctx.userId, ctx.runId, ctx.toolCallId, 'fact') };
      },
    }),
    defineTool({
      name: 'forget',
      description:
        'Delete one saved preference at the current user’s explicit request. Copy its factId and exact fact text from known facts so the human can review what will be removed. This removes the saved fact, not original conversation transcripts. Requires human approval.',
      risk: 'destructive',
      scenario: 'remove an unwanted or outdated customer preference',
      input: z.object({ factId: z.uuid(), fact: z.string().min(3).max(300) }),
      timeoutMs: 1_000,
      retries: 0,
      execute: async ({ factId, fact }, ctx) => {
        const removed = await db
          .delete(facts)
          .where(and(eq(facts.id, factId), eq(facts.userId, ctx.userId), eq(facts.fact, fact)))
          .returning({ id: facts.id });
        // Unknown IDs and other users' IDs have the same no-op response.
        return { factId, removed: removed.length === 1 };
      },
    }),
  ];
}

/** Facts injected into the system prompt, newest first, scoped to one user. */
export async function userFacts(db: Db, userId: string, limit = 20): Promise<string[]> {
  const rows = await db
    .select({ factId: facts.id, fact: facts.fact, source: facts.source, recordedAt: facts.createdAt })
    .from(facts)
    .where(eq(facts.userId, userId))
    .orderBy(desc(facts.createdAt))
    .limit(limit);
  return rows.map((r) => JSON.stringify({ ...r, recordedAt: r.recordedAt.toISOString() }));
}
