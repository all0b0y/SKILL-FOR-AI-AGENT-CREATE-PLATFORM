import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres; run files one at a time.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'src/agent/tools/**',
        'src/identity.ts',
        'src/agent/guardrails.ts',
        'src/memory/**',
        'src/agent/window.ts',
        'src/agent/compact.ts',
        'src/lib/run-events.ts',
      ],
      thresholds: {
        'src/agent/tools/**': { lines: 100, functions: 100 },
        'src/identity.ts': { lines: 100, functions: 100, branches: 100 },
        lines: 85,
      },
    },
  },
});
