import { db } from '@/db/client';
import { runSpans } from '@/runs/service';
import { handle, json } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/** Return trace spans only after the lifecycle service verifies run ownership; missing and foreign runs have the same not-found behavior. */
export const GET = handle<Ctx>(async (_request, who, { params }) =>
  json({ spans: await runSpans(db, who, (await params).id) }),
);
