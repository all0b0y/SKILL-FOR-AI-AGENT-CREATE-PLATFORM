/**
 * Client-side model of a run, rebuilt by folding the event log. Pure: the same events always
 * produce the same view, which is what makes reload-and-resume trivial.
 */
export type ToolView = {
  toolCallId: string;
  tool: string;
  input: unknown;
  status: 'running' | 'awaiting_approval' | 'done' | 'error' | 'denied' | 'cancelled';
  output?: unknown;
  approvalId?: string;
};

/** Client projection of ordered text/tool blocks, authoritative status, budget usage and the last applied durable event sequence. */
export type RunView = {
  status: 'queued' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'cancelled';
  /** Ordered blocks: assistant text and tool calls interleaved as they happened. */
  blocks: Array<{ kind: 'text'; id: number; text: string } | { kind: 'tool'; toolCallId: string }>;
  tools: Record<string, ToolView>;
  usage: { steps: number; maxSteps: number; costUsd: number; maxCostUsd: number } | null;
  error: string | null;
  lastSeq: number;
};

/** A persisted, monotonically sequenced event used to reconstruct or resume the client projection. */
export type RunEvent = { seq: number; type: string; data: Record<string, unknown> };

/** Create a fresh queued projection with no events, tools, usage or error; each call returns independent mutable containers. */
export const emptyRun = (): RunView => ({
  status: 'queued',
  blocks: [],
  tools: {},
  usage: null,
  error: null,
  lastSeq: 0,
});

/** Set authoritative status from either a log event or the SSE end snapshot. O(tools). */
export function applyRunStatus(view: RunView, status: RunView['status']): RunView {
  const tools = { ...view.tools };
  if (['done', 'failed', 'cancelled'].includes(status)) {
    for (const [id, tool] of Object.entries(tools)) {
      // A terminal run cannot accept pending decisions; preserve completed side effects.
      if (tool.status === 'awaiting_approval')
        tools[id] = { ...tool, status: 'cancelled', approvalId: undefined };
    }
  }
  return { ...view, status, tools };
}

/** Apply one event. O(blocks + tools) copying; events at or below lastSeq are ignored (idempotent replay). */
export function applyEvent(view: RunView, e: RunEvent): RunView {
  if (e.seq <= view.lastSeq) return view;
  const next: RunView = { ...view, lastSeq: e.seq, tools: { ...view.tools }, blocks: [...view.blocks] };
  const d = e.data;
  const id = String(d.toolCallId ?? '');
  switch (e.type) {
    case 'text': {
      const last = next.blocks.at(-1);
      if (last?.kind === 'text')
        next.blocks[next.blocks.length - 1] = { ...last, text: last.text + String(d.text) };
      else next.blocks.push({ kind: 'text', id: e.seq, text: String(d.text) });
      break;
    }
    case 'tool-call':
      if (!next.tools[id]) next.blocks.push({ kind: 'tool', toolCallId: id });
      next.tools[id] = { toolCallId: id, tool: String(d.tool), input: d.input, status: 'running' };
      break;
    case 'approval-request': {
      const existing = next.tools[id] ?? {
        toolCallId: id,
        tool: String(d.tool),
        input: d.input,
        status: 'running' as const,
      };
      if (!next.tools[id]) next.blocks.push({ kind: 'tool', toolCallId: id });
      next.tools[id] = { ...existing, status: 'awaiting_approval', approvalId: String(d.approvalId) };
      break;
    }
    case 'approval-response': {
      const tool = Object.values(next.tools).find((t) => t.approvalId === d.approvalId);
      if (tool) next.tools[tool.toolCallId] = { ...tool, status: d.approved ? 'running' : 'denied' };
      break;
    }
    case 'tool-result':
    case 'tool-error': {
      const tool = next.tools[id];
      if (tool)
        next.tools[id] = {
          ...tool,
          status: e.type === 'tool-result' ? 'done' : 'error',
          output: d.output ?? d.error,
        };
      break;
    }
    case 'usage':
      next.usage = {
        steps: Number(d.steps),
        maxSteps: Number(d.maxSteps),
        costUsd: Number(d.costUsd),
        maxCostUsd: Number(d.maxCostUsd),
      };
      break;
    case 'status':
      next.error = typeof d.error === 'string' ? d.error : null;
      return applyRunStatus(next, d.status as RunView['status']);
    default:
      break;
  }
  return next;
}
