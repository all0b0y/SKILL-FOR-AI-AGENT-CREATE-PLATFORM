import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadCases } from '@/evals/cases';
import { securityFixturesDir } from '@/evals/security-fixtures';

const body = (origin: string) =>
  `id: sample\norigin: ${origin}\nkind: typical\ninput: How long does delivery take?\ngraders:\n- type: status\n  equals: done\n`;

function load(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'af-cases-'));
  writeFileSync(join(dir, 'sample.yaml'), text);
  return loadCases(dir);
}

test('synthetic reference fixtures have their own origin, distinct from approved interview/generated cases', () => {
  for (const origin of ['interview', 'generated', 'synthetic']) expect(load(body(origin)).errors).toEqual([]);
  expect(load(body('approved')).errors).not.toEqual([]);
});

test('every shipped reference case and dev-only security case is marked synthetic', () => {
  const fixtures = securityFixturesDir();
  for (const dir of [undefined, ...(fixtures ? [join(fixtures, 'evals', 'cases')] : [])]) {
    const { cases, errors } = loadCases(dir);
    expect(errors).toEqual([]);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.filter((c) => c.origin !== 'synthetic').map((c) => c.id)).toEqual([]);
  }
});
