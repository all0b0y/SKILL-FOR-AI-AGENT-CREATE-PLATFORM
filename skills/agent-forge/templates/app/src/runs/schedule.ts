import { z } from 'zod';
import type { Db } from '@/db/client';
import { startRun } from './service';

/** Separate pg-boss queue for operator-created schedule occurrences. */
export const SCHEDULE_QUEUE = 'agent-schedules';
const ScheduledTask = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  userId: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(4_000),
  reference: z.enum(['support', 'researcher', 'background']).optional(),
});
/** Validate a named scheduled task, bounded prompt, persisted reference, cron string and IANA timezone. Registration remains an explicit operator action. */
export const ScheduleDefinition = ScheduledTask.extend({
  cron: z.string().min(1).max(100),
  timezone: z
    .string()
    .default('UTC')
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
});

/** A scheduled occurrence is a normal owned durable run, never a privileged agent shortcut. */
export async function dispatchScheduled(
  db: Db,
  enqueue: Parameters<typeof startRun>[1],
  jobId: string,
  payload: unknown,
) {
  const task = ScheduledTask.parse(payload);
  return startRun(
    db,
    enqueue,
    { userId: task.userId, roles: ['user'] },
    {
      text: task.text,
      surface: 'cron',
      ...(task.reference ? { reference: task.reference } : {}),
      idempotencyKey: `cron:${task.name}:${jobId}`,
    },
  );
}
