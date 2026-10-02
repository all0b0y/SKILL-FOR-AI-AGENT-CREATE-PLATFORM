/**
 * Eval case format (evals/cases/<id>.yaml) and its graders. Deterministic graders first;
 * `judge` only where no ground truth exists (EV-02, EV-03).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const Grader = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool_called'),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal('tool_not_called'), tool: z.string() }),
  z.object({ type: z.literal('text_matches'), pattern: z.string(), flags: z.string().default('i') }),
  z.object({ type: z.literal('text_not_matches'), pattern: z.string(), flags: z.string().default('i') }),
  z.object({
    type: z.literal('status'),
    equals: z.enum(['done', 'awaiting_approval', 'failed', 'cancelled']),
  }),
  z.object({ type: z.literal('max_steps'), value: z.number().int().positive() }),
  z.object({ type: z.literal('max_cost_usd'), value: z.number().positive() }),
  z.object({
    type: z.literal('judge'),
    rubric: z
      .record(z.string(), z.string())
      .refine((r) => Object.keys(r).length >= 2, 'judge needs ≥2 named rubric dimensions'),
    threshold: z.number().min(0).max(1),
  }),
]);

/** Validate an individual eval case, explicit origin/profile, bounded repetitions and deterministic or rubric-based graders. */
export const Case = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  origin: z.enum(['interview', 'generated']),
  reference: z.enum(['support', 'researcher', 'background']).optional(),
  kind: z.enum(['typical', 'edge', 'adversarial']).default('typical'),
  input: z.string().min(1),
  /** Approve (true) or reject (false) every approval request; omitted = stop at the request. */
  approve: z.boolean().optional(),
  repeat: z.number().int().min(1).max(10).default(1),
  graders: z.array(Grader).min(1),
});
/** Validated eval case data after defaults and schema checks. */
export type Case = z.infer<typeof Case>;
/** Discriminated deterministic assertion or paid judge rubric attached to an eval case. */
export type Grader = z.infer<typeof Grader>;

/** Default case directory relative to the application working directory. */
export const CASES_DIR = join(process.cwd(), 'evals', 'cases');

/** Load and validate every case; collects all errors instead of stopping at the first. */
export function loadCases(dir = CASES_DIR): { cases: Case[]; errors: string[] } {
  const cases: Case[] = [];
  const errors: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()) {
    const parsed = Case.safeParse(parse(readFileSync(join(dir, file), 'utf8')));
    if (!parsed.success) {
      errors.push(
        `ERROR: evals/cases/${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
      continue;
    }
    if (`${parsed.data.id}.yaml` !== file)
      errors.push(`ERROR: evals/cases/${file}: id "${parsed.data.id}" must match the file name.`);
    if (parsed.data.kind === 'adversarial' && parsed.data.graders.some((g) => g.type === 'judge')) {
      errors.push(`ERROR: evals/cases/${file}: adversarial cases use deterministic graders only.`);
    }
    cases.push(parsed.data);
  }
  return { cases, errors };
}

/** Holdout membership: stable hash of the id, ~25 %. FNV-1a, O(len(id)). */
export function isHoldout(id: string): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) % 4 === 0;
}

/** Minimal outcome, text, tool-call and budget evidence consumed by deterministic graders. */
export type Transcript = {
  status: string;
  text: string;
  toolCalls: Array<{ tool: string; input: unknown }>;
  steps: number;
  costUsd: number;
};

/** Grade a transcript with one deterministic grader; judge graders are graded elsewhere. */
export function gradeDeterministic(
  g: Exclude<Grader, { type: 'judge' }>,
  t: Transcript,
): { pass: boolean; detail: string } {
  switch (g.type) {
    case 'tool_called': {
      const hit = t.toolCalls.find(
        (c) =>
          c.tool === g.tool &&
          Object.entries(g.args ?? {}).every(
            ([k, v]) => JSON.stringify((c.input as Record<string, unknown>)[k]) === JSON.stringify(v),
          ),
      );
      return {
        pass: Boolean(hit),
        detail: hit ? `${g.tool} called` : `${g.tool} not called with ${JSON.stringify(g.args ?? {})}`,
      };
    }
    case 'tool_not_called': {
      const hit = t.toolCalls.some((c) => c.tool === g.tool);
      return { pass: !hit, detail: hit ? `${g.tool} was called` : `${g.tool} not called` };
    }
    case 'text_matches':
      return { pass: new RegExp(g.pattern, g.flags).test(t.text), detail: `text ~ /${g.pattern}/` };
    case 'text_not_matches':
      return { pass: !new RegExp(g.pattern, g.flags).test(t.text), detail: `text !~ /${g.pattern}/` };
    case 'status':
      return { pass: t.status === g.equals, detail: `status ${t.status}` };
    case 'max_steps':
      return { pass: t.steps <= g.value, detail: `${t.steps} steps` };
    case 'max_cost_usd':
      return { pass: t.costUsd <= g.value, detail: `$${t.costUsd.toFixed(5)}` };
  }
}
