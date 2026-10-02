/**
 * Runs eval cases through the real run executor (queue bypassed), each under its own eval
 * user, then deletes everything that user created.
 */

import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveModel } from '@/agent/model';
import { executeRun } from '@/agent/run';
import type { Db } from '@/db/client';
import { conversations, facts, runEvents, runs, spans, tickets } from '@/db/schema';
import { decideApproval, startRun } from '@/runs/service';
import { type Case, type Grader, gradeDeterministic, type Transcript } from './cases';
import { type Cassette, type Mode, withCassette } from './cassette';
import { evalRunOptions } from './determinism';

type GraderResult = { grader: Grader['type']; pass: boolean; detail: string };
/** Per-case repetitions with grader outcomes, billed cost, actual prompt hashes and aggregate all-repetitions acceptance. */
export type CaseResult = {
  id: string;
  kind: Case['kind'];
  reference: NonNullable<Case['reference']>;
  runs: Array<{
    pass: boolean;
    graders: GraderResult[];
    costUsd: number;
    promptHashes: string[];
    error?: string;
  }>;
  pass: boolean;
};

const MAX_RESUMES = 3;

async function transcript(db: Db, runId: string): Promise<Transcript> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  const events = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));
  return {
    status: run?.status ?? 'missing',
    steps: run?.steps ?? 0,
    costUsd: Number(run?.costUsd ?? 0),
    text: events
      .filter((e) => e.type === 'text')
      .map((e) => (e.data as { text: string }).text)
      .join(''),
    toolCalls: events
      .filter((e) => e.type === 'tool-call')
      .map((e) => e.data as { tool: string; input: unknown }),
  };
}

async function judge(
  g: Extract<Grader, { type: 'judge' }>,
  c: Case,
  t: Transcript,
  judgeModelId: string,
  cassette: Cassette,
  mode: Mode,
): Promise<GraderResult> {
  if (judgeModelId === 'mock')
    return { grader: 'judge', pass: false, detail: 'judge needs a real model: set AF_JUDGE_MODEL' };
  const dims = Object.entries(g.rubric)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const { text } = await generateText({
    model: withCassette(resolveModel(judgeModelId), cassette, mode),
    prompt: `Score the assistant reply against each rubric dimension from 0 to 1. Reply with JSON only: {"scores":{"<dimension>":<number>}}.\n\nRubric:\n${dims}\n\nUser: ${c.input}\n\nAssistant: ${t.text}`,
  });
  const { scores } = z
    .object({ scores: z.record(z.string(), z.number().min(0).max(1)) })
    .parse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
  const values = Object.keys(g.rubric).map((k) => scores[k] ?? 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    grader: 'judge',
    pass: mean >= g.threshold,
    detail: `mean ${mean.toFixed(2)} (threshold ${g.threshold})`,
  };
}

/** Run one case `repeat` times; it passes only if every repetition passes (pass^k, EV-07). */
export async function runCase(
  db: Db,
  c: Case,
  opts: { modelId: string; cassette: Cassette; mode: Mode; judgeModelId: string },
): Promise<CaseResult> {
  if (!Number.isInteger(c.repeat) || c.repeat < 1 || c.repeat > 20)
    throw new Error('Invalid repetition count');
  const reference = c.reference ?? 'support';
  const results: CaseResult['runs'] = [];
  for (let rep = 0; rep < c.repeat; rep++) {
    const who = { userId: `eval:${randomUUID()}`, roles: ['user'] as const };
    try {
      const deterministic = evalRunOptions(c.id, rep);
      const model = withCassette(resolveModel(opts.modelId, reference), opts.cassette, opts.mode);
      const { runId } = await startRun(db, async () => {}, who, {
        text: c.input,
        reference,
        surface: reference === 'background' ? 'cron' : 'chat',
        idempotencyKey: `eval:${c.id}:${rep}:${Date.now()}`,
      });
      let status = await executeRun(db, runId, { model, modelId: opts.modelId, ...deterministic });
      for (let i = 0; status === 'awaiting_approval' && c.approve !== undefined && i < MAX_RESUMES; i++) {
        const pending = await db
          .select({ data: runEvents.data })
          .from(runEvents)
          .where(and(eq(runEvents.runId, runId), eq(runEvents.type, 'approval-request')));
        for (const p of pending) {
          const { approvalId } = p.data as { approvalId: string };
          await decideApproval(db, async () => {}, who, { runId, approvalId, approved: c.approve }).catch(
            () => {},
          );
        }
        status = await executeRun(db, runId, { model, modelId: opts.modelId, ...deterministic });
      }
      const t = await transcript(db, runId);
      // Preserve actual prompt provenance before isolated run data is deleted in finally.
      const promptHashes = (
        await db.selectDistinct({ hash: spans.promptHash }).from(spans).where(eq(spans.runId, runId))
      )
        .map((row) => row.hash)
        .filter((hash): hash is string => hash !== null)
        .sort();
      const graders: GraderResult[] = [];
      for (const g of c.graders) {
        graders.push(
          g.type === 'judge'
            ? await judge(g, c, t, opts.judgeModelId, opts.cassette, opts.mode)
            : { grader: g.type, ...gradeDeterministic(g, t) },
        );
      }
      const failedRun =
        t.status === 'failed'
          ? (await db.select({ error: runs.error }).from(runs).where(eq(runs.id, runId)))[0]?.error
          : undefined;
      // A failed run (e.g. missing recording) is red unless the case expects failure, so
      // "nothing happened" can never satisfy negative graders like tool_not_called.
      const expectsFailure = c.graders.some((g) => g.type === 'status' && g.equals === 'failed');
      const pass = graders.every((g) => g.pass) && (t.status !== 'failed' || expectsFailure);
      results.push({
        pass,
        graders,
        costUsd: t.costUsd,
        promptHashes,
        ...(failedRun ? { error: failedRun } : {}),
      });
    } catch (e) {
      results.push({
        pass: false,
        graders: [],
        costUsd: 0,
        promptHashes: [],
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      await cleanupEvalData(db, who.userId);
    }
  }
  return { id: c.id, kind: c.kind, reference, runs: results, pass: results.every((r) => r.pass) };
}

/** Delete only the isolated user created by this repetition, never another eval session. */
async function cleanupEvalData(db: Db, userId: string): Promise<void> {
  await db.delete(conversations).where(eq(conversations.userId, userId));
  await db.delete(tickets).where(eq(tickets.userId, userId));
  await db.delete(facts).where(eq(facts.userId, userId));
}
