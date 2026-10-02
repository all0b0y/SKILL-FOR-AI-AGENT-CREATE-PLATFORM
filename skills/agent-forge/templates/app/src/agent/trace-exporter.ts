import { SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { Db } from '@/db/client';
import { spans } from '@/db/schema';

/** OTel exporter backing the local timeline. No provider SDK objects or raw requests are stored. */
export class PostgresSpanExporter implements SpanExporter {
  constructor(private readonly db: Db) {}
  export(batch: ReadableSpan[], callback: Parameters<SpanExporter['export']>[1]): void {
    const rows = batch.map((span) => ({
      runId: String(span.attributes['af.run_id']),
      kind: String(span.attributes['af.kind']) as typeof spans.$inferInsert.kind,
      name: span.name,
      status: span.status.code === SpanStatusCode.ERROR ? ('error' as const) : ('ok' as const),
      startedAt: new Date(span.startTime[0] * 1000 + span.startTime[1] / 1e6),
      endedAt: new Date(span.endTime[0] * 1000 + span.endTime[1] / 1e6),
      promptHash: String(span.attributes['af.prompt_hash']),
      inputTokens: Number(span.attributes['gen_ai.usage.input_tokens'] ?? 0),
      outputTokens: Number(span.attributes['gen_ai.usage.output_tokens'] ?? 0),
      costUsd: Number(span.attributes['af.cost_usd'] ?? 0),
      attrs: {
        ...JSON.parse(String(span.attributes['af.metadata'] ?? '{}')),
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      },
    }));
    if (!rows.length) {
      callback({ code: 0 });
      return;
    }
    this.db
      .insert(spans)
      .values(rows)
      .then(
        () => callback({ code: 0 }),
        () => callback({ code: 1 }),
      );
  }
  async shutdown(): Promise<void> {}
}
