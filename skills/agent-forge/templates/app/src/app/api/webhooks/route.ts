/**
 * Webhook surface. The sender's delivery id is the idempotency key, so a redelivery returns
 * the same run instead of acting twice. Identity comes from the seam like every other surface.
 */
import { z } from 'zod';
import { db } from '@/db/client';
import { enqueueRun } from '@/runs/queue';
import { startRun } from '@/runs/service';
import { body, handle, json } from '@/server/http';

const Payload = z.object({ text: z.string().trim().min(1).max(4_000) });

/** Create an owned webhook run from validated text and the required delivery header. Redelivery uses the same durable run rather than repeating its side effects. */
export const POST = handle(async (request, who) => {
  const deliveryId = request.headers.get('x-delivery-id');
  if (!deliveryId) return json({ error: 'x-delivery-id header required for idempotency' }, 400);
  const { text } = await body(request, Payload);
  const run = await startRun(db, enqueueRun, who, {
    text,
    idempotencyKey: `webhook:${deliveryId}`,
    surface: 'webhook',
  });
  return json(run, run.duplicate ? 200 : 202);
});
