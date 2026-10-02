/** Offline acceptance against real Compose web + worker + a fresh, ephemeral Postgres. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const project = `af-smoke-${randomBytes(4).toString('hex')}`;
const port = Number(process.env.AF_SMOKE_PORT ?? 3200);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid AF_SMOKE_PORT');
mkdirSync('.agent-forge', { recursive: true });
const override = resolve(`.agent-forge/${project}.yml`);
const env = {
  ...process.env,
  AF_SMOKE_DB_PASSWORD: randomBytes(24).toString('hex'),
  AF_SMOKE_APPROVAL_SECRET: randomBytes(32).toString('hex'),
};
// No local env file is loaded. Credentials are generated for this isolated, offline run.
writeFileSync(
  override,
  `services:
  db:
    ports: !reset []
    volumes: !reset []
    tmpfs: [/var/lib/postgresql/data]
    environment:
      POSTGRES_PASSWORD: \${AF_SMOKE_DB_PASSWORD}
${['app', 'worker', 'migrate']
  .map(
    (service) => `  ${service}:
    image: agent-forge-smoke:local
    env_file: !reset []
    environment:
      DATABASE_URL: postgres://app:\${AF_SMOKE_DB_PASSWORD}@db:5432/app
      APPROVAL_SECRET: \${AF_SMOKE_APPROVAL_SECRET}
      AF_MODEL: mock
      AF_REFERENCE: support
      AF_EMBEDDING_MODEL: hash
      AF_ALLOW_PAID_EMBEDDINGS: '0'
      AF_ALLOW_PAID_CALLS: '0'
      IDENTITY_ADAPTER: local
${service === 'app' ? `    ports: !override ["127.0.0.1:${port}:3000"]\n` : ''}`,
  )
  .join('')}`,
);

function compose(args, capture = false) {
  const result = spawnSync(
    'docker',
    ['compose', '-p', project, '-f', 'docker-compose.yml', '-f', override, ...args],
    {
      env,
      stdio: capture ? 'pipe' : 'inherit',
      encoding: 'utf8',
      timeout: 600_000,
    },
  );
  assert.equal(result.status, 0, `Compose ${args[0]} failed`);
  return result.stdout?.trim();
}
const origin = `http://127.0.0.1:${port}`;
async function request(path, data, status = 200) {
  const response = await fetch(`${origin}${path}`, {
    ...(data === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, status, `${path}: HTTP ${response.status}`);
  return response;
}
async function events(runId) {
  const text = await (await request(`/api/runs/${runId}/events`)).text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('id:') || chunk.startsWith('event:'))
    .map((chunk) => ({
      type: chunk.match(/^event: (.+)$/m)?.[1],
      data: JSON.parse(chunk.match(/^data: (.+)$/m)?.[1] ?? '{}'),
    }));
}
function ticketCount() {
  return Number(
    compose(
      ['exec', '-T', 'db', 'psql', '-U', 'app', '-d', 'app', '-Atc', 'select count(*) from tickets'],
      true,
    ),
  );
}

try {
  compose(['up', '-d', '--build']);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await request('/');
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(250);
    }
  }
  compose(['exec', '-T', 'worker', 'pnpm', 'kb:ingest']);
  const body = { text: 'My order arrived damaged', idempotencyKey: `${project}-ticket` };
  const run = await (await request('/api/runs', body, 202)).json();
  const duplicate = await (await request('/api/runs', body)).json();
  assert.equal(duplicate.runId, run.runId);
  assert.equal(duplicate.duplicate, true);
  const pending = await events(run.runId);
  assert.equal(pending.at(-1).data.status, 'awaiting_approval');
  const approvalId = pending.find((e) => e.type === 'approval-request').data.approvalId;
  assert.equal(ticketCount(), 0);
  await request(`/api/runs/${run.runId}/approval`, { approvalId: 'forged', approved: true }, 409);
  await request(`/api/runs/${run.runId}/approval`, { approvalId, approved: true });
  assert.equal((await events(run.runId)).at(-1).data.status, 'done');
  assert.equal(ticketCount(), 1);
  await request(`/api/runs/${run.runId}/approval`, { approvalId, approved: true }, 409);
  const stopped = await (
    await request('/api/runs', { text: 'Another item is broken', idempotencyKey: `${project}-stop` }, 202)
  ).json();
  assert.equal((await events(stopped.runId)).at(-1).data.status, 'awaiting_approval');
  await request(`/api/runs/${stopped.runId}/cancel`, {});
  assert.equal((await events(stopped.runId)).at(-1).data.status, 'cancelled');
  const followup = await (
    await request(
      '/api/runs',
      {
        text: 'How long does delivery take?',
        conversationId: stopped.conversationId,
        idempotencyKey: `${project}-followup`,
      },
      202,
    )
  ).json();
  const answer = await events(followup.runId);
  assert.equal(answer.at(-1).data.status, 'done');
  assert(
    answer
      .filter((e) => e.type === 'text')
      .map((e) => e.data.text)
      .join('')
      .includes('delivery.md'),
  );
  assert.equal(ticketCount(), 1);
  compose(['exec', '-T', 'worker', 'pnpm', 'cron', 'put', 'scripts/fixtures/cron-smoke.json']);
  compose(['exec', '-T', 'worker', 'pnpm', 'cron', 'put', 'scripts/fixtures/background-smoke.json']);
  const cronDeadline = Date.now() + 180_000;
  let cronRun;
  while (!cronRun && Date.now() < cronDeadline) {
    cronRun = compose(
      [
        'exec',
        '-T',
        'db',
        'psql',
        '-U',
        'app',
        '-d',
        'app',
        '-Atc',
        "select id from runs where surface = 'cron' and reference = 'support' and user_id = 'local' order by created_at limit 1",
      ],
      true,
    );
    if (!cronRun) await delay(1000);
  }
  compose(['exec', '-T', 'worker', 'pnpm', 'cron', 'remove', 'offline-smoke']);
  assert(cronRun, 'Real scheduler did not dispatch within 180 seconds');
  assert.equal((await events(cronRun)).at(-1).data.status, 'awaiting_approval');
  assert.equal(ticketCount(), 1, 'Cron must not bypass human approval');
  await request(`/api/runs/${cronRun}/cancel`, {});
  assert.equal((await events(cronRun)).at(-1).data.status, 'cancelled');
  let digestRun;
  while (!digestRun && Date.now() < cronDeadline) {
    digestRun = compose(
      [
        'exec',
        '-T',
        'db',
        'psql',
        '-U',
        'app',
        '-d',
        'app',
        '-Atc',
        "select id from runs where surface = 'cron' and reference = 'background' and user_id = 'local' order by created_at limit 1",
      ],
      true,
    );
    if (!digestRun) await delay(1000);
  }
  compose(['exec', '-T', 'worker', 'pnpm', 'cron', 'remove', 'background-reference']);
  assert(digestRun, 'Background reference did not dispatch');
  const digest = await events(digestRun);
  assert.equal(digest.at(-1).data.status, 'done');
  const digestText = digest
    .filter((e) => e.type === 'text')
    .map((e) => e.data.text)
    .join('');
  for (const source of ['delivery.md', 'returns.md', 'warranty.md']) assert(digestText.includes(source));
  assert(digestText.includes('Scheduled evidence digest'));
  assert.equal(digest.filter((e) => e.type === 'approval-request').length, 0);
  assert.equal(ticketCount(), 1, 'Read-only background reference must not create tickets');
  console.log(
    'Compose smoke passed: migration, container worker, SSE, idempotency, approval, cancellation, follow-up citation, real cron dispatch with HITL, separate read-only background digest with three citations. Offline mock only.',
  );
} finally {
  // No volume/image/cache pruning. Only this script's containers/network are removed.
  try {
    compose(['down', '--timeout', '60']);
  } finally {
    unlinkSync(override);
  }
}
