import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { loadPrompt } from '@/agent/prompts';
import { db } from '@/db/client';
import { Case } from '@/evals/cases';
import { Cassette } from '@/evals/cassette';
import { runCase } from '@/evals/runner';
import { reset, seedKb } from './helpers';

beforeEach(async () => {
  await reset();
  await seedKb();
});

test('the eval case, not the worker environment, selects the reference in record and replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'reference-eval-'));
  try {
    for (const reference of ['researcher', 'background']) {
      const c = Case.parse({
        id: `eval-${reference}`,
        reference,
        origin: 'generated',
        input: 'Compare delivery and returns',
        graders: [
          { type: 'status', equals: 'done' },
          {
            type: 'text_matches',
            pattern: reference === 'researcher' ? 'Source comparison' : 'Scheduled evidence digest',
          },
          { type: 'text_matches', pattern: 'delivery\\.md' },
          { type: 'text_matches', pattern: 'returns\\.md' },
          { type: 'tool_not_called', tool: 'ticket_create' },
        ],
      });
      const path = join(directory, `${reference}.json`);
      const cassette = new Cassette(path);
      const recorded = await runCase(db, c, {
        modelId: 'mock',
        judgeModelId: 'mock',
        cassette,
        mode: 'record',
      });
      expect(recorded.pass).toBe(true);
      expect(recorded.runs[0]?.promptHashes).toContain(loadPrompt(reference).hash);
      cassette.save();
      expect(
        (
          await runCase(db, c, {
            modelId: 'mock',
            judgeModelId: 'mock',
            cassette: new Cassette(path),
            mode: 'replay',
          })
        ).pass,
      ).toBe(true);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
