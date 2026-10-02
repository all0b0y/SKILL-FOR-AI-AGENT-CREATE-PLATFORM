/**
 * Adversarial fixtures (literal prompt-injection inputs) are kept out of the distributed skill
 * package, because skill installers scan package text and quarantine it. The source repository
 * keeps them in a `security-fixtures/` directory at its root; a generated product has none and
 * owns its adversarial cases in `evals/cases`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const DIR = 'security-fixtures';
const MARKER = 'prompt-injection.json';

/** Adversarial input and the profile it targets, read from the dev-only fixture package. */
export const InjectionFixture = z
  .object({
    reference: z.enum(['support', 'researcher', 'background']),
    input: z.string().min(1),
  })
  .strict();

/**
 * Dev-only fixture directory: `AF_SECURITY_FIXTURES` when set (must exist), otherwise the nearest
 * ancestor of *cwd* containing `security-fixtures/`, otherwise `undefined`.
 */
export function securityFixturesDir(cwd = process.cwd()): string | undefined {
  const configured = process.env.AF_SECURITY_FIXTURES;
  if (configured) {
    const dir = resolve(cwd, configured);
    if (!existsSync(join(dir, MARKER))) throw new Error(`AF_SECURITY_FIXTURES has no ${MARKER}: ${dir}`);
    return dir;
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, DIR, MARKER))) return join(dir, DIR);
    if (dirname(dir) === dir) return undefined;
  }
}

/** Validated injection inputs from *dir*, or an empty list when there is no fixture directory. */
export function injectionFixtures(dir: string | undefined): z.infer<typeof InjectionFixture>[] {
  if (!dir) return [];
  return z
    .array(InjectionFixture)
    .min(1)
    .parse(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')));
}
