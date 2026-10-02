/**
 * USD per million tokens. The cost ceiling depends on these numbers, so an unknown model is
 * an error at startup, never a silent zero.
 */
const PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  mock: { input: 0, output: 0 },
  // Add one entry per model you set in AF_MODEL, with the provider's current list price:
  // 'anthropic/<model-id>': { input: <usd per 1M input tokens>, output: <usd per 1M output tokens> },
};

/** Resolve explicit USD-per-million input/output rates.
 * @throws Error when the model has no price entry.
 */
export function priceOf(model: string): { input: number; output: number } {
  const price = PRICES[model];
  if (!price) throw new Error(`No price for model "${model}". Add it to src/agent/pricing.ts.`);
  return price;
}

/** Convert input/output token counts to USD using the configured per-million rates. Unknown models throw through priceOf; mock usage is explicitly free. */
export function costUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const p = priceOf(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
