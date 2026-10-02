/** Serialize cost persistence while reserving synchronously, so parallel tools cannot overspend. */
import type { EmbeddingBudget } from './embedding-provider';

/** Reserve cost synchronously before serialized durable writes, preventing concurrent overcommit. Return a one-shot settlement that refunds only confirmed unused cost; persistence failure leaves the ledger fail-closed. */
export function embeddingBudget(options: {
  limit: number;
  current: () => number;
  set: (usd: number) => void;
  persist: () => Promise<void>;
}): EmbeddingBudget {
  let pending = Promise.resolve();
  const persist = () => {
    pending = pending.then(options.persist);
    return pending;
  };
  return {
    async reserve(usd) {
      const total = options.current();
      if (
        !Number.isFinite(usd) ||
        usd < 0 ||
        !Number.isFinite(options.limit) ||
        options.limit <= 0 ||
        total + usd > options.limit
      )
        throw new Error('Embedding budget exhausted or not configured');
      options.set(total + usd);
      await persist();
      let settled = false;
      return async (usage) => {
        if (settled || !Number.isFinite(usage.costUsd) || usage.costUsd < 0 || usage.costUsd > usd)
          throw new Error('Invalid embedding cost settlement');
        settled = true;
        options.set(options.current() - usd + usage.costUsd);
        await persist();
      };
    },
  };
}
