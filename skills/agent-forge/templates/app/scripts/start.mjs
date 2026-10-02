#!/usr/bin/env node
// Production entry. Refuses to expose a single-user (local identity) app to the network:
// the agent holds API keys and spends money, so a public bind needs an identity adapter.
import { spawn } from 'node:child_process';

const host = process.env.HOST ?? '127.0.0.1';
const adapter = process.env.IDENTITY_ADAPTER ?? 'local';
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);

if (adapter === 'local' && !loopback && process.env.AF_ALLOW_PUBLIC_LOCAL !== 'docker-internal') {
  console.error(
    `ERROR: public bind (HOST=${host}) requires an identity adapter. Set IDENTITY_ADAPTER=trusted-header or HOST=127.0.0.1.`,
  );
  process.exit(1);
}
const child = spawn('pnpm', ['exec', 'next', 'start', '-H', host, '-p', process.env.PORT ?? '3000'], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
