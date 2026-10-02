import { db } from '@/db/client';
import { cancelRun } from '@/runs/service';
import { handle, json } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/** Cancel an owned run idempotently. This prevents future tool calls but cannot undo an already-running external operation. */
export const POST = handle<Ctx>(async (_request, who, { params }) => {
  await cancelRun(db, who, (await params).id);
  return json({ ok: true });
});
