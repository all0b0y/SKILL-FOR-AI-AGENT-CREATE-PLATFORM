// Playwright-owned processes: mock-only worker and production server, stopped together.
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  AF_MODEL: 'mock',
  AF_EMBEDDING_MODEL: 'hash',
  AF_ALLOW_PAID_EMBEDDINGS: '0',
  AF_ALLOW_PAID_CALLS: '0',
};
const children = [
  spawn(process.execPath, ['--env-file=.env.local', '--import', 'tsx', 'src/worker.ts'], {
    env,
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    ['--env-file=.env.local', 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3100'],
    { env, stdio: 'inherit' },
  ),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 5000);
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once('exit', resolve);
        }),
    ),
  ).then(() => {
    clearTimeout(timeout);
    process.exit(code);
  });
}
for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', (code) => stop(code ?? 1));
}
process.once('SIGTERM', () => stop(0));
process.once('SIGINT', () => stop(0));
