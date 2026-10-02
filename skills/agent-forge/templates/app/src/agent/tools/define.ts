/**
 * The tool contract. Native tools and MCP tools both pass through {@link defineTool}, so
 * least privilege, approval, timeouts, retries, idempotency and error shape are enforced in
 * one place instead of per tool.
 */
import { type FlexibleSchema, type Tool, tool } from 'ai';
import type { z } from 'zod';
import { capText, mask } from '../guardrails';

type Risk = 'read' | 'write' | 'destructive';

/** Per-call identity, durable replay receipts, cancellation checks and tracing supplied by the run executor. Never synthesize this context from model arguments. */
export type ToolContext = {
  userId: string;
  runId: string;
  toolCallId: string;
  /** Returns the stored output when this exact call already ran (replayed step). */
  recall: (toolCallId: string) => Promise<unknown | undefined>;
  remember: (toolCallId: string, tool: string, output: unknown) => Promise<void>;
  assertActive?: () => Promise<void>;
  span: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

/** Native/MCP registration contract: validated input, risk, justified scenario, bounded retry/timeout policy and implementation. Side effects must preserve the operation identity across retries. */
export type ToolSpec<I extends z.ZodType, O> = {
  /** snake_case; prefixed by service when tools come from more than one service. */
  name: string;
  /** What it does and when to use it — this is the model's only documentation. */
  description: string;
  risk: Risk;
  /** The AGENT_SPEC scenario that justifies this tool (least privilege). */
  scenario: string;
  input: I;
  timeoutMs: number;
  /** Retries on thrown errors; must be 0 for destructive tools. */
  retries: number;
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<O>;
};

/** What the model sees when a tool fails: what went wrong and what to do next (BU-05). */
type ToolFailure = { error: { message: string; fix: string } };

/** Non-retryable tool argument failure with a concrete correction for the model; converted to structured tool output rather than retried. */
export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly fix: string,
  ) {
    super(message);
  }
}

/** A validated tool specification and factory binding the current run context to the AI SDK tool. */
export type RegisteredTool = {
  spec: ToolSpec<z.ZodType, unknown>;
  build: (ctx: Omit<ToolContext, 'toolCallId'>) => Tool;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Race a promise against a timeout. The underlying work is not cancelled (no AbortSignal in
 * every client), so tools with side effects rely on idempotency, not on this timeout.
 */
async function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exponential backoff with full jitter: delay ∈ [0, base·2^attempt). O(1) per attempt.
 * Jitter spreads retries of concurrent runs so they do not hammer an API in lockstep.
 */
export function backoffMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 200,
  capMs = 5_000,
): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt));
}

/**
 * Register a tool.
 * @throws Error at startup when the spec breaks the contract (bad name, retries on destructive).
 */
export function defineTool<I extends z.ZodType, O>(spec: ToolSpec<I, O>): RegisteredTool {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(`tool name "${spec.name}" must be snake_case`);
  if (spec.risk === 'destructive' && spec.retries > 0) {
    throw new Error(`tool "${spec.name}" is destructive: retries must be 0`);
  }
  if (!spec.scenario.trim()) throw new Error(`tool "${spec.name}" has no scenario (least privilege)`);

  // Zod 4 schemas are Standard Schemas; the cast only bridges generic inference in tool().
  const inputSchema = spec.input as unknown as FlexibleSchema<z.infer<I>>;
  const build = (base: Omit<ToolContext, 'toolCallId'>): Tool =>
    tool<z.infer<I>, unknown, Record<string, never>>({
      description: spec.description,
      inputSchema,
      execute: async (input, { toolCallId }) => {
        const ctx: ToolContext = { ...base, toolCallId };
        await ctx.assertActive?.();
        const sideEffect = spec.risk !== 'read';
        if (sideEffect) {
          const previous = await ctx.recall(toolCallId);
          if (previous !== undefined) return previous; // replayed step: never act twice (AR-14)
        }
        const output = await ctx.span(`tool:${spec.name}`, () => runWithRetries(spec, input, ctx));
        if (sideEffect && !isFailure(output)) await ctx.remember(toolCallId, spec.name, output);
        return output;
      },
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: capText(mask(typeof output === 'string' ? output : JSON.stringify(output))),
      }),
    }) as Tool;

  return { spec: spec as unknown as ToolSpec<z.ZodType, unknown>, build };
}

const isFailure = (x: unknown): x is ToolFailure => typeof x === 'object' && x !== null && 'error' in x;

async function runWithRetries<I extends z.ZodType, O>(
  spec: ToolSpec<I, O>,
  input: z.infer<I>,
  ctx: ToolContext,
): Promise<O | ToolFailure> {
  for (let attempt = 0; ; attempt++) {
    try {
      await ctx.assertActive?.();
      return await withTimeout(spec.timeoutMs, () => spec.execute(input, ctx));
    } catch (e) {
      if (e instanceof ToolInputError) return { error: { message: e.message, fix: e.fix } };
      if (attempt >= spec.retries) {
        const message = e instanceof Error ? e.message : String(e);
        // Returned, not thrown: the model reads it and adapts (BU-17); the run's failure
        // counter escalates to a human after the configured threshold (BU-15).
        return {
          error: {
            message: `${spec.name} failed: ${mask(message)}`,
            fix: 'Tell the user the action could not be completed and offer to escalate; do not invent a result.',
          },
        };
      }
      await sleep(backoffMs(attempt));
    }
  }
}
