/**
 * Database schema. One Postgres holds runs, events, traces, memory and the queue (pg-boss
 * creates its own schema). Tables for memory kinds the spec disables are deleted in the
 * build phase together with their code.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Embedding width of the configured embedder (src/memory/embed.ts). */
export const EMBEDDING_DIMENSIONS = 256;

/** Owner-scoped conversation identity, persisted reference and versioned compaction state. Original messages live in the separate ordered history table. */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    reference: text('reference', { enum: ['support', 'researcher', 'background'] })
      .notNull()
      .default('support'),
    /** Compacted summary of messages older than the working window (BU-08). */
    summary: text('summary'),
    createdAt: createdAt(),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.createdAt)],
);

/** Working memory: the model-message history of a conversation, in order. */
export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** AI SDK ModelMessage, stored verbatim so a run can resume from it. */
    message: jsonb('message').notNull(),
    compacted: integer('compacted').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.id)],
);

/** Persisted lifecycle enum; approval is a resting state distinct from completion or cancellation. */
export const runStatus = pgEnum('run_status', [
  'queued',
  'running',
  'awaiting_approval',
  'done',
  'failed',
  'cancelled',
]);

/** Durable run identity, delivery deduplication, profile, status and budget ledger. Indexed by owner/status and conversation for bounded access. */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    surface: text('surface', { enum: ['chat', 'cron', 'webhook'] }).notNull(),
    reference: text('reference', { enum: ['support', 'researcher', 'background'] })
      .notNull()
      .default('support'),
    status: runStatus('status').notNull().default('queued'),
    /** Dedupe key for webhook/cron deliveries and chat retries. */
    idempotencyKey: text('idempotency_key').notNull(),
    steps: integer('steps').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('runs_idempotency_idx').on(t.idempotencyKey),
    index('runs_user_status_idx').on(t.userId, t.status, t.createdAt),
    index('runs_conversation_idx').on(t.conversationId, t.createdAt),
  ],
);

/**
 * Append-only event log of a run. The UI streams from it, so a reload resumes from the
 * last seen `seq` instead of losing the run.
 */
export const runEvents = pgTable(
  'run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type', {
      enum: [
        'text',
        'tool-call',
        'tool-result',
        'tool-error',
        'approval-request',
        'approval-response',
        'status',
        'usage',
      ],
    }).notNull(),
    data: jsonb('data').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('run_events_run_seq_idx').on(t.runId, t.seq)],
);

/** Results of side-effecting tool calls keyed by (run, tool call): a replayed step short-circuits (AR-14). */
export const toolExecutions = pgTable(
  'tool_executions',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id').notNull(),
    tool: text('tool').notNull(),
    output: jsonb('output').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tool_executions_key_idx').on(t.runId, t.toolCallId)],
);

/** Trace spans: metadata only by default (no conversation text, no secrets). */
export const spans = pgTable(
  'spans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    kind: text('kind', { enum: ['run', 'step', 'tool', 'guardrail'] }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['ok', 'error'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    promptHash: text('prompt_hash'),
    attrs: jsonb('attrs').notNull().default({}),
  },
  (t) => [index('spans_run_idx').on(t.runId, t.startedAt)],
);

/** Knowledge memory: chunks searched by vector + full-text hybrid. */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    embeddingModel: text('embedding_model').notNull().default('hash-v1:256'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    search: tsvector('search').notNull().generatedAlwaysAs(sql`to_tsvector('simple', title || ' ' || body)`),
  },
  (t) => [
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_search_idx').using('gin', t.search),
  ],
);

/** Long-term facts about a user, written only through the `remember` tool, deletable on request. */
export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    fact: text('fact').notNull(),
    /** Where the fact came from: run id + tool call id. */
    source: text('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('facts_user_idx').on(t.userId, t.createdAt)],
);

/** Stand-in for the external helpdesk until a real adapter is configured. */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('tickets_user_idx').on(t.userId, t.createdAt)],
);
