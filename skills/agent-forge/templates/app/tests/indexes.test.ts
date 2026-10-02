/** Every frequent query uses an index (EXPLAIN), so latency does not grow with table size. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { db } from '@/db/client';
import { hashEmbed } from '@/memory/embed';
import { reset } from './helpers';

async function plan(query: ReturnType<typeof sql>): Promise<string> {
  await db.execute(sql`set enable_seqscan = off`);
  const res = await db.execute<{ 'QUERY PLAN': string }>(sql`explain ${query}`);
  await db.execute(sql`set enable_seqscan = on`);
  return res.rows.map((r) => r['QUERY PLAN']).join('\n');
}

beforeAll(reset);
afterAll(reset);

describe('index usage', () => {
  const vector = JSON.stringify(hashEmbed('delivery'));
  test.each([
    [
      'vector search uses HNSW',
      sql`select id from chunks order by embedding <=> ${vector}::vector limit 20`,
      'chunks_embedding_idx',
    ],
    [
      'full-text search uses GIN',
      sql`select id from chunks where search @@ websearch_to_tsquery('simple', 'delivery')`,
      'chunks_search_idx',
    ],
    [
      'run events by run use the (run, seq) index',
      sql`select * from run_events where run_id = '00000000-0000-0000-0000-000000000001' and seq > 0 order by seq`,
      'run_events_run_seq_idx',
    ],
    [
      'runs list per user uses its index',
      sql`select * from runs where user_id = 'u' order by created_at desc limit 50`,
      'runs_user_status_idx',
    ],
    [
      'facts per user use their index',
      sql`select fact from facts where user_id = 'u' order by created_at desc limit 20`,
      'facts_user_idx',
    ],
    [
      'conversation history uses its index',
      sql`select * from messages where conversation_id = '00000000-0000-0000-0000-000000000001' order by id`,
      'messages_conversation_idx',
    ],
  ])('%s', async (_name, query, index) => {
    expect(await plan(query)).toContain(index);
  });
});
