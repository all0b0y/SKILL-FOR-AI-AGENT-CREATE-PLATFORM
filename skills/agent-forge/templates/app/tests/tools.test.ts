/**
 * Tool seam tests (TDD contract): for every tool — success, actionable error, input
 * validation; plus the registry-wide contract (idempotency, retries, timeouts).
 */
import type { Tool } from 'ai';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineTool, type ToolContext } from '@/agent/tools/define';
import { createRegistry, userFacts } from '@/agent/tools/registry';
import { db } from '@/db/client';
import { facts, tickets } from '@/db/schema';
import { reset, seedKb } from './helpers';

const stored = new Map<string, unknown>();
const base: Omit<ToolContext, 'toolCallId'> = {
  userId: 'alice',
  runId: '00000000-0000-0000-0000-000000000001',
  recall: async (id) => stored.get(id),
  remember: async (id, _tool, output) => void stored.set(id, output),
  span: (_name, fn) => fn(),
};

async function call(tool: Tool, input: unknown, toolCallId = 'c1'): Promise<unknown> {
  const parsed = await (tool.inputSchema as unknown as z.ZodType).safeParseAsync(input);
  if (!parsed.success) return { invalid: parsed.error.issues.map((i) => i.path.join('.')) };
  return tool.execute?.(parsed.data as never, { toolCallId, messages: [], context: {} as never });
}

const tools = () =>
  Object.fromEntries(createRegistry(db).map((t) => [t.spec.name, t.build(base)])) as Record<string, Tool>;

beforeEach(async () => {
  stored.clear();
  await reset();
  await seedKb();
});

describe('kb_search', () => {
  test('returns passages wrapped as untrusted data with their source', async () => {
    const out = String(await call(tools().kb_search as Tool, { query: 'how long is delivery' }));
    expect(out).toContain('<untrusted_data source="kb:delivery.md">');
    expect(out.indexOf('delivery.md')).toBeLessThan(
      out.indexOf('returns.md') === -1 ? Infinity : out.indexOf('returns.md'),
    );
  });
  test('says so when nothing matches', async () => {
    await reset();
    expect(await call(tools().kb_search as Tool, { query: 'anything' })).toMatch(/No passages found/);
  });
  test('rejects a too-short query', async () => {
    expect(await call(tools().kb_search as Tool, { query: 'a' })).toEqual({ invalid: ['query'] });
  });
});

describe('ticket_create', () => {
  test('creates one ticket for the calling user', async () => {
    const out = (await call(tools().ticket_create as Tool, {
      subject: 'Broken box',
      details: 'Arrived crushed',
    })) as { ticketId: string };
    const rows = await db.select().from(tickets).where(eq(tickets.id, out.ticketId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe('alice');
  });
  test('a replayed tool call returns the stored result and does not create a second ticket', async () => {
    const t = tools().ticket_create as Tool;
    const first = await call(t, { subject: 'Broken box', details: 'Arrived crushed' }, 'same');
    const again = await call(t, { subject: 'Broken box', details: 'Arrived crushed' }, 'same');
    expect(again).toEqual(first);
    expect(await db.select().from(tickets)).toHaveLength(1);
  });
  test('a crash after the side effect but before recording cannot duplicate a ticket', async () => {
    const t = tools().ticket_create as Tool;
    const first = await call(t, { subject: 'Broken box', details: 'Arrived crushed' }, 'crash');
    stored.clear(); // simulate losing the executor acknowledgement
    const again = await call(
      tools().ticket_create as Tool,
      { subject: 'Broken box', details: 'Arrived crushed' },
      'crash',
    );
    expect(again).toEqual(first);
    expect(await db.select().from(tickets)).toHaveLength(1);
  });
  test('validates subject and details', async () => {
    expect(await call(tools().ticket_create as Tool, { subject: 'x', details: 'y' })).toEqual({
      invalid: ['subject', 'details'],
    });
  });
});

describe('remember', () => {
  test('stores a fact with its provenance, scoped to the user', async () => {
    await call(tools().remember as Tool, { fact: 'Prefers delivery to Kazan' }, 'r1');
    expect((await userFacts(db, 'alice')).map((value) => JSON.parse(value).fact)).toEqual([
      'Prefers delivery to Kazan',
    ]);
    expect(await userFacts(db, 'bob')).toEqual([]);
    const [row] = await db.select().from(facts);
    expect(row?.source).toBe(`${base.runId}:r1`);
  });
  test('refuses payment data with an actionable error', async () => {
    const out = await call(tools().remember as Tool, { fact: 'card 4111111111111111' });
    expect(out).toEqual({
      error: { message: 'looks like a card number', fix: expect.stringMatching(/Do not store payment data/) },
    });
    expect(await db.select().from(facts)).toHaveLength(0);
  });
});

describe('tool contract', () => {
  const echoInput = z.object({ v: z.string() });
  const echo = (over: Partial<Parameters<typeof defineTool<typeof echoInput, unknown>>[0]> = {}) =>
    defineTool<typeof echoInput, unknown>({
      name: 'echo_tool',
      description: 'echo',
      risk: 'read',
      scenario: 'test',
      input: echoInput,
      timeoutMs: 50,
      retries: 0,
      execute: async ({ v }) => v,
      ...over,
    });

  test('rejects bad names, retries on destructive tools, and missing scenarios at startup', () => {
    expect(() => echo({ name: 'Bad-Name' })).toThrow(/snake_case/);
    expect(() => echo({ risk: 'destructive', retries: 1 })).toThrow(/retries must be 0/);
    expect(() => echo({ scenario: ' ' })).toThrow(/no scenario/);
  });
  test('retries transient failures, then returns an actionable error instead of throwing', async () => {
    let attempts = 0;
    const flaky = echo({
      retries: 2,
      execute: async () => {
        attempts += 1;
        throw new Error('upstream 503');
      },
    }).build(base);
    expect(await call(flaky, { v: 'x' })).toEqual({
      error: { message: 'echo_tool failed: upstream 503', fix: expect.any(String) },
    });
    expect(attempts).toBe(3);
  });
  test('times out slow calls', async () => {
    const slow = echo({ execute: () => new Promise((r) => setTimeout(() => r('late'), 500)) }).build(base);
    expect(await call(slow, { v: 'x' })).toMatchObject({
      error: { message: expect.stringMatching(/timed out after 50 ms/) },
    });
  });
  test('model sees capped, masked output', async () => {
    const leaky = echo({
      execute: async () => `key sk-ant-api03-${'k'.repeat(30)} ${'z'.repeat(9_000)}`,
    }).build(base);
    const shown = (
      leaky as {
        toModelOutput: (o: { output: unknown; toolCallId: string; input: unknown }) => { value: string };
      }
    ).toModelOutput({
      output: await call(leaky, { v: 'x' }),
      toolCallId: 'c',
      input: {},
    });
    expect(shown.value).toContain('[secret]');
    expect(shown.value).toMatch(/\[truncated \d+ chars/);
  });
});
