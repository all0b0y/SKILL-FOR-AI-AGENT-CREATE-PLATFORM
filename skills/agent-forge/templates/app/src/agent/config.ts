/**
 * Run limits — document changes in ARCHITECTURE.md and validate them against accepted evals.
 */
export const AGENT_CONFIG = {
  maxSteps: 8,
  maxCostUsdPerRun: 0.05,
  failureThreshold: 2,
  /** Working-memory budget in characters (~4 chars per token). */
  contextBudgetChars: 24_000,
} as const;
