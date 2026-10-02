/**
 * Model resolution. AF_MODEL picks one model explicitly; an unknown id is an error, never a
 * silent fallback to another model.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { env } from '@/env';
import { type Reference, referenceOf } from '@/reference';
import { mockSupportModel } from './mock-model';
import { priceOf } from './pricing';

/** Resolve exactly the configured model after validating its price and required credentials; never fall back.
 * @throws Error for an unsupported provider prefix or a model without a price entry.
 */
export function resolveModel(id = env().AF_MODEL, reference: Reference = referenceOf()): LanguageModelV4 {
  priceOf(id); // the cost ceiling needs a price: fail at startup, not mid-run
  if (id === 'mock') return mockSupportModel(15, reference);
  const [provider, ...rest] = id.split('/');
  const modelId = rest.join('/');
  if (provider === 'anthropic' && modelId) {
    const key = env().ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is required for AF_MODEL=anthropic/...');
    return createAnthropic({ apiKey: key })(modelId) as LanguageModelV4;
  }
  throw new Error(
    `Unsupported AF_MODEL "${id}". Use "mock" or "anthropic/<model-id>", or add a provider in src/agent/model.ts.`,
  );
}
