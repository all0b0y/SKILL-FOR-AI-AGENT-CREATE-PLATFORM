import { z } from 'zod';
import { db } from '@/db/client';
import { enqueueRun } from '@/runs/queue';
import { recentRuns, startRun } from '@/runs/service';
import { body, handle, json } from '@/server/http';

const StartBody = z.object({
  text: z.string().trim().min(1).max(4_000),
  conversationId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

/** Validate and enqueue an owned chat turn atomically. Return 202 for a new run or 200 with the same identity on duplicate delivery. */
export const POST = handle(async (request, who) => {
  const input = await body(request, StartBody);
  const run = await startRun(db, enqueueRun, who, input);
  return json(run, run.duplicate ? 200 : 202);
});

/** List recent run metadata according to the resolved user/operator visibility policy; never return conversation bodies. */
export const GET = handle(async (_request, who) => json({ runs: await recentRuns(db, who) }));
