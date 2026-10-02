import { createServer } from 'node:http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, test } from 'vitest';
import { Tracer } from '@/agent/trace';
import { db } from '@/db/client';
import { spans } from '@/db/schema';
import { startRun } from '@/runs/service';
import { alice, reset } from './helpers';

beforeEach(reset);

test('real OTel exports the same redacted span to Postgres and local OTLP HTTP collector', async () => {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      bodies.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  const { runId } = await startRun(db, async () => {}, alice, {
    text: 'private customer message',
    idempotencyKey: 'otel-test',
  });
  const tracer = new Tracer(
    db,
    'test-prompt-hash',
    false,
    new OTLPTraceExporter({ url: `http://127.0.0.1:${address.port}/v1/traces` }),
  );
  try {
    await tracer.record(
      {
        runId,
        kind: 'step',
        name: 'step:1',
        attrs: {
          surface: 'chat',
          'content.prompt': 'private customer message',
          error: 'customer@example.com',
          arbitrary: 'untrusted raw prompt',
        },
      },
      new Date(),
      'ok',
      { inputTokens: 7, outputTokens: 3, costUsd: 0.01 },
    );
    const rows = await db.select().from(spans).where(eq(spans.runId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inputTokens).toBe(7);
    expect(bodies).toHaveLength(1);
    for (const serialized of [JSON.stringify(rows), bodies.join('')]) {
      expect(serialized).not.toContain('private customer message');
      expect(serialized).not.toContain('customer@example.com');
      expect(serialized).not.toContain('untrusted raw prompt');
      expect(serialized).toContain('test-prompt-hash');
    }
  } finally {
    await tracer.shutdown();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
