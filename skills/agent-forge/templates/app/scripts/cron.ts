/** Operator-only schedule management. No schedules are installed on worker startup. */
import { readFileSync } from 'node:fs';
import { boss } from '../src/runs/queue';
import { SCHEDULE_QUEUE, ScheduleDefinition } from '../src/runs/schedule';

const [command, value] = process.argv.slice(2);
if (!['put', 'remove', 'list'].includes(command ?? ''))
  throw new Error('Usage: pnpm cron put <json-file> | remove <name> | list');
const queue = await boss();
try {
  await queue.createQueue(SCHEDULE_QUEUE);
  if (command === 'put') {
    if (!value) throw new Error('Schedule JSON file required');
    const { cron, timezone, ...task } = ScheduleDefinition.parse(JSON.parse(readFileSync(value, 'utf8')));
    await queue.schedule(SCHEDULE_QUEUE, cron, task, { key: task.name, tz: timezone, retryLimit: 3 });
    const saved = await queue.getSchedules(SCHEDULE_QUEUE, task.name);
    if (saved.length !== 1 || saved[0]?.cron !== cron || saved[0]?.timezone !== timezone)
      throw new Error('Schedule read-back failed');
    console.log(`Saved schedule ${task.name} (${timezone})`);
  } else if (command === 'remove') {
    const name = ScheduleDefinition.shape.name.parse(value);
    await queue.unschedule(SCHEDULE_QUEUE, name);
    if ((await queue.getSchedules(SCHEDULE_QUEUE, name)).length) throw new Error('Schedule still exists');
    console.log(`Removed schedule ${name}`);
  } else {
    // Omit payloads: they can contain user text.
    console.table(
      (await queue.getSchedules(SCHEDULE_QUEUE)).map((s) => ({
        name: s.key,
        cron: s.cron,
        timezone: s.timezone,
      })),
    );
  }
} finally {
  await queue.stop({ graceful: true });
}
