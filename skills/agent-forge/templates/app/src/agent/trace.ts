/** OpenTelemetry spans → Postgres timeline, with optional standard OTLP/HTTP export. */
import { SpanStatusCode } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { Db } from '@/db/client';
import { mask } from './guardrails';
import { PostgresSpanExporter } from './trace-exporter';

/** Run-correlated trace metadata. Attribute content is filtered by the tracer; supplying arbitrary attributes does not enable conversation logging. */
export type SpanInput = {
  runId: string;
  parentId?: string | undefined;
  kind: 'run' | 'step' | 'tool' | 'guardrail';
  name: string;
  attrs?: Record<string, unknown>;
};

/** Record and flush run/step/tool spans to Postgres and an optional OTLP exporter. Only allowlisted metadata is emitted by default; opt-in content is masked. Call shutdown when the run ends. */
export class Tracer {
  private readonly provider: BasicTracerProvider;
  constructor(
    db: Db,
    private readonly promptHash: string,
    private readonly withContent: boolean,
    extraExporter?: SpanExporter,
  ) {
    const exporters: SpanExporter[] = [new PostgresSpanExporter(db)];
    // OTel's own exporter handles standard endpoint/header env configuration. Disabled by default.
    if (extraExporter) exporters.push(extraExporter);
    else if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) exporters.push(new OTLPTraceExporter());
    this.provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'agent-forge' }),
      spanProcessors: exporters.map((exporter) => new SimpleSpanProcessor(exporter)),
    });
  }

  async span<T>(input: SpanInput, fn: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    try {
      const out = await fn();
      await this.record(input, startedAt, 'ok');
      return out;
    } catch (error) {
      await this.record(
        { ...input, attrs: { ...input.attrs, error: 'operation failed' } },
        startedAt,
        'error',
      );
      throw error;
    }
  }

  async record(
    input: SpanInput,
    startedAt: Date,
    status: 'ok' | 'error',
    usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined; costUsd?: number },
  ): Promise<void> {
    // Allowlist metadata instead of trusting arbitrary key names to contain no conversation text.
    const metadata = Object.fromEntries(
      Object.entries(input.attrs ?? {}).filter(
        ([key]) =>
          ['surface', 'finishReason'].includes(key) || (this.withContent && key.startsWith('content.')),
      ),
    );
    const span = this.provider.getTracer('agent-forge').startSpan(input.name, {
      startTime: startedAt,
      attributes: {
        'af.run_id': input.runId,
        'af.kind': input.kind,
        'af.prompt_hash': this.promptHash,
        'af.metadata': mask(JSON.stringify(metadata), { pii: true }),
        'gen_ai.usage.input_tokens': usage?.inputTokens ?? 0,
        'gen_ai.usage.output_tokens': usage?.outputTokens ?? 0,
        'af.cost_usd': usage?.costUsd ?? 0,
      },
    });
    span.setStatus({ code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
    span.end();
    await this.provider.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}
