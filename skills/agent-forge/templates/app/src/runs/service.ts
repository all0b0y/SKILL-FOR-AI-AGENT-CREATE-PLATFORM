/**
 * Run lifecycle used by every surface. All functions take the caller's identity and scope
 * every query by userId — a user can never read or approve another user's run.
 */
import type { ModelMessage } from 'ai';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { conversations, messages, runEvents, runs, spans } from '@/db/schema';
import type { Identity } from '@/identity';
import { type Reference, referenceOf } from '@/reference';

/** Uniform HTTP 404 for missing or foreign-owned state, avoiding disclosure of another user's resources. */
export class NotFoundError extends Error {
  readonly status = 404;
}
class ConflictError extends Error {
  readonly status = 409;
}

/** Application transaction shared with the enqueue adapter so durable state and job publication commit atomically. */
export type RunTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Enqueue = (runId: string, tx: RunTransaction) => Promise<void>;

/**
 * Append a user message and queue a run. Idempotent per `idempotencyKey`: a retried request
 * (double click, webhook redelivery) returns the existing run instead of starting another.
 */
export async function startRun(
  db: Db,
  enqueue: Enqueue,
  who: Identity,
  input: {
    text: string;
    conversationId?: string | undefined;
    idempotencyKey: string;
    surface?: 'chat' | 'cron' | 'webhook';
    /** Internal/operator field; public request parsers do not expose it. */
    reference?: Reference;
  },
): Promise<{ runId: string; conversationId: string; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    // Serialize by delivery key before checking existence; prevents concurrent redelivery races.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`);
    const existing = await tx
      .select({ id: runs.id, conversationId: runs.conversationId, userId: runs.userId })
      .from(runs)
      .where(eq(runs.idempotencyKey, input.idempotencyKey));
    const hit = existing.find((r) => r.userId === who.userId);
    if (hit) return { runId: hit.id, conversationId: hit.conversationId, duplicate: true };
    if (existing.length) throw new ConflictError('idempotency key already used');

    const reference = referenceOf(input.reference);
    let conversationId = input.conversationId;
    if (conversationId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${conversationId}, 1))`);
      const [conv] = await tx
        .select({ id: conversations.id, reference: conversations.reference })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, who.userId)));
      if (!conv) throw new NotFoundError('conversation not found');
      if (conv.reference !== reference)
        throw new ConflictError('Start a new conversation when changing reference');
      const [busy] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.conversationId, conversationId),
            inArray(runs.status, ['queued', 'running', 'awaiting_approval']),
          ),
        );
      if (busy) throw new ConflictError('conversation has an active or pending run');
    } else {
      const [conv] = await tx
        .insert(conversations)
        .values({ userId: who.userId, title: input.text.slice(0, 60), reference })
        .returning({ id: conversations.id });
      conversationId = conv?.id;
    }
    if (!conversationId) throw new Error('conversation insert failed');
    const message: ModelMessage = { role: 'user', content: input.text };
    await tx.insert(messages).values({ conversationId, message });
    const [run] = await tx
      .insert(runs)
      .values({
        userId: who.userId,
        conversationId,
        surface: input.surface ?? 'chat',
        reference,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: runs.id });
    if (!run) throw new Error('run insert failed');
    await enqueue(run.id, tx);
    return { runId: run.id, conversationId, duplicate: false };
  });
}

async function ownRun(db: Db | RunTransaction, who: Identity, runId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, who.userId)));
  if (!run) throw new NotFoundError('run not found');
  return run;
}

/**
 * Record the human decision and resume the run. The approval id is checked against the
 * pending request; the AI SDK additionally verifies the request signature.
 */
export async function decideApproval(
  db: Db,
  enqueue: Enqueue,
  who: Identity,
  input: { runId: string; approvalId: string; approved: boolean; reason?: string | undefined },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.runId}, 2))`);
    const run = await ownRun(tx, who, input.runId);
    if (run.status !== 'awaiting_approval')
      throw new ConflictError(`run is ${run.status}, not awaiting approval`);
    const pending = await tx
      .select({ data: runEvents.data, type: runEvents.type })
      .from(runEvents)
      .where(eq(runEvents.runId, run.id))
      .orderBy(asc(runEvents.seq));
    const requested = pending
      .filter((e) => e.type === 'approval-request')
      .map((e) => (e.data as { approvalId: string }).approvalId);
    const answered = pending
      .filter((e) => e.type === 'approval-response')
      .map((e) => (e.data as { approvalId: string }).approvalId);
    if (!requested.includes(input.approvalId) || answered.includes(input.approvalId)) {
      throw new ConflictError('no pending approval with this id');
    }
    const reason = input.reason?.slice(0, 500) ?? (input.approved ? 'approved by user' : 'rejected by user');
    const message: ModelMessage = {
      role: 'tool',
      content: [
        { type: 'tool-approval-response', approvalId: input.approvalId, approved: input.approved, reason },
      ],
    };
    const seq =
      Math.max(
        0,
        ...(await tx.select({ seq: runEvents.seq }).from(runEvents).where(eq(runEvents.runId, run.id))).map(
          (r) => r.seq,
        ),
      ) + 1;
    await tx.insert(messages).values({ conversationId: run.conversationId, message });
    await tx.insert(runEvents).values({
      runId: run.id,
      seq,
      type: 'approval-response',
      data: { approvalId: input.approvalId, approved: input.approved, reason },
    });
    const stillPending = requested.filter((id) => id !== input.approvalId && !answered.includes(id));
    if (stillPending.length === 0) {
      await tx.update(runs).set({ status: 'queued', updatedAt: new Date() }).where(eq(runs.id, run.id));
      await enqueue(run.id, tx);
    }
  });
}

/** Stop a run. The executor checks this flag before every step, so no further tool runs. */
export async function cancelRun(db: Db, who: Identity, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 2))`);
    const run = await ownRun(tx, who, runId);
    if (['done', 'failed', 'cancelled'].includes(run.status)) return;
    await tx.update(runs).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(runs.id, runId));
  });
}

/** Verify ownership and return the current run plus ordered events strictly after the requested sequence. The caller controls transport and subsequent polling. */
export async function eventsSince(db: Db, who: Identity, runId: string, afterSeq: number) {
  const run = await ownRun(db, who, runId);
  const rows = await db
    .select({
      seq: runEvents.seq,
      type: runEvents.type,
      data: runEvents.data,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, run.id), gt(runEvents.seq, afterSeq)))
    .orderBy(asc(runEvents.seq));
  return { run, events: rows };
}

/** Restore owned turns from server records; browser storage contains no transcript. */
export async function conversationTurns(db: Db, who: Identity, conversationId: string) {
  const [owned] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, who.userId)));
  if (!owned) throw new NotFoundError('conversation not found');
  const result = await db.execute<{ runId: string; question: string }>(sql`
    select r.id as "runId", m.message->>'content' as question from runs r
    cross join lateral (
      select message from messages where conversation_id = r.conversation_id
        and message->>'role' = 'user' and created_at <= r.created_at
      order by id desc limit 1
    ) m
    where r.conversation_id = ${conversationId} and r.user_id = ${who.userId}
    order by r.created_at, r.id`);
  return result.rows;
}

/** Latest runs for the operator console, newest first, with their trace spans. */
export async function recentRuns(db: Db, who: Identity, limit = 50) {
  const admin = who.roles.includes('admin');
  const base = db.select().from(runs);
  const list = await (admin ? base : base.where(eq(runs.userId, who.userId)))
    .orderBy(desc(runs.createdAt))
    .limit(limit);
  return list;
}

/** Read trace spans only after verifying ownership; shared by the trace API and detail view. */
export async function runSpans(db: Db, who: Identity, runId: string) {
  return (await runDetail(db, who, runId)).spans;
}

/** Read owned run metadata and its trace, including the conversation link for recovery. */
export async function runDetail(db: Db, who: Identity, runId: string) {
  const run = await ownRun(db, who, runId);
  const trace = await db
    .select()
    .from(spans)
    .where(eq(spans.runId, run.id))
    .orderBy(asc(spans.startedAt), asc(spans.id));
  return { run, spans: trace };
}

/** Conversation transcript as stored model messages (user + assistant text only). */
export async function conversationMessages(db: Db, who: Identity, conversationId: string) {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, who.userId)));
  if (!conv) throw new NotFoundError('conversation not found');
  return db
    .select({ id: messages.id, message: messages.message })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
}
