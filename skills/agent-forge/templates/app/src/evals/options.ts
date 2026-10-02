/** Fail closed before any provider or database work. */
export function repeatCount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count < 1 || count > 20)
    throw new Error('--repeat must be an integer from 1 to 20');
  return count;
}

/** Reject semantic embeddings during replay and reject non-mock record/live calls without explicit per-command paid consent. Call before provider work. */
export function requirePaidConsent(mode: string, modelId: string): void {
  if (mode === 'replay' && (process.env.AF_EMBEDDING_MODEL ?? 'hash') !== 'hash')
    throw new Error(
      'Replay requires offline hash embeddings and a matching index; semantic retrieval is a separate paid acceptance.',
    );
  if (mode !== 'replay' && modelId !== 'mock' && process.env.AF_ALLOW_PAID_CALLS !== '1')
    throw new Error('Paid calls require explicit consent: set AF_ALLOW_PAID_CALLS=1 for this command only.');
}
