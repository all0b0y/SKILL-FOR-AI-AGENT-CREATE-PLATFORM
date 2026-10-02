import { z } from 'zod';
import { db } from '@/db/client';
import { enqueueRun } from '@/runs/queue';
import { decideApproval } from '@/runs/service';
import { body, handle, json } from '@/server/http';

const Decision = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/** Validate an owned approval decision and atomically enqueue its continuation. The lifecycle service checks the approval identity and current state before acting. */
export const POST = handle<Ctx>(async (request, who, { params }) => {
  const { id } = await params;
  await decideApproval(db, enqueueRun, who, { runId: id, ...(await body(request, Decision)) });
  return json({ ok: true });
});
