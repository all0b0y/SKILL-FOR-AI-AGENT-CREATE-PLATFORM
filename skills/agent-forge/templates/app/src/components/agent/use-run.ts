'use client';

import { useEffect, useReducer, useState } from 'react';
import { applyEvent, applyRunStatus, emptyRun, type RunEvent, type RunView } from '@/lib/run-events';

/** Durable run projection plus transport connectivity; a disconnected stream does not imply a failed or cancelled server run. */
export type StreamView = RunView & {
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'disconnected';
};

const EVENT_TYPES = [
  'text',
  'tool-call',
  'tool-result',
  'tool-error',
  'approval-request',
  'approval-response',
  'status',
  'usage',
];

/**
 * Subscribe to a run's event stream. EventSource reconnects on its own and sends
 * Last-Event-ID, so the view resumes after network drops; `epoch` re-opens the stream after
 * the run is resumed (approval) or restarted.
 */
export function useRun(runId: string | null, epoch = 0): StreamView {
  const [connection, setConnection] = useState<StreamView['connection']>('connecting');
  const [view, dispatch] = useReducer(
    (state: RunView, action: RunEvent | { end: RunView['status'] } | 'reset') =>
      action === 'reset'
        ? emptyRun()
        : 'end' in action
          ? applyRunStatus(state, action.end)
          : applyEvent(state, action),
    undefined,
    emptyRun,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `epoch` deliberately re-opens the stream after a resume
  useEffect(() => {
    if (!runId) return;
    dispatch('reset');
    setConnection('connecting');
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onopen = () => setConnection('open');
    source.onerror = () =>
      setConnection(source.readyState === EventSource.CLOSED ? 'disconnected' : 'reconnecting');
    const onEvent = (type: string) => (msg: MessageEvent<string>) => {
      const data = JSON.parse(msg.data) as Record<string, unknown> & { seq: number };
      dispatch({ seq: data.seq, type, data });
    };
    const handlers = EVENT_TYPES.map((t) => [t, onEvent(t)] as const);
    for (const [t, h] of handlers) source.addEventListener(t, h);
    source.addEventListener('end', (msg: MessageEvent<string>) => {
      const { status } = JSON.parse(msg.data) as { status: RunView['status'] };
      dispatch({ end: status });
      setConnection('closed');
      source.close();
    });
    return () => {
      source.onopen = null;
      source.onerror = null;
      source.close();
    };
  }, [runId, epoch]);

  return { ...view, connection };
}
