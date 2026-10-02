/**
 * Server-sent events for one run. Reads the run_events log from `after` (or Last-Event-ID),
 * so a reload or a dropped connection resumes exactly where it left off.
 */
import { db } from '@/db/client';
import { eventsSince } from '@/runs/service';
import { handle } from '@/server/http';

const POLL_MS = 250;
const MAX_STREAM_MS = 5 * 60_000;
const RESTING = new Set(['done', 'failed', 'cancelled', 'awaiting_approval']);

type Ctx = { params: Promise<{ id: string }> };

/** Stream owned durable events after Last-Event-ID or the supplied cursor, then emit an authoritative resting-state snapshot. Reconnection replays missing events; no model call occurs in this route. */
export const GET = handle<Ctx>(async (request, who, { params }) => {
  const { id } = await params;
  const url = new URL(request.url);
  let after = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0) || 0;
  await eventsSince(db, who, id, after); // 404 before opening the stream
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        while (!request.signal.aborted && Date.now() - started < MAX_STREAM_MS) {
          const { run, events } = await eventsSince(db, who, id, after);
          for (const e of events) {
            send(
              `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify({ seq: e.seq, ...(e.data as object) })}\n\n`,
            );
            after = e.seq;
          }
          if (RESTING.has(run.status) && events.length === 0) {
            send(`event: end\ndata: ${JSON.stringify({ status: run.status })}\n\n`);
            break;
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
});
