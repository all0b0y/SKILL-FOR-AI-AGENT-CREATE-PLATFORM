/**
 * Validated environment. Read once; a missing or malformed value fails at startup with the
 * variable name instead of surfacing later as an undefined deep inside a run.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AF_MODEL: z.string().min(1).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  APPROVAL_SECRET: z.string().min(16, 'APPROVAL_SECRET must be at least 16 characters'),
  IDENTITY_ADAPTER: z.enum(['local', 'trusted-header']).default('local'),
  IDENTITY_HEADER: z.string().default('x-user-id'),
  IDENTITY_HEADER_SECRET: z.string().optional(),
  TRACE_CONTENT: z.enum(['0', '1']).default('0'),
});

/** Validated server-only settings; never expose the database, provider or identity credentials to client modules. */
export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Validate and cache server settings; reject incomplete signed-header configuration.
 * @throws Error naming every invalid variable, without printing its value.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment (see .env.example):\n${lines.join('\n')}`);
  }
  if (parsed.data.IDENTITY_ADAPTER === 'trusted-header' && !parsed.data.IDENTITY_HEADER_SECRET) {
    throw new Error('IDENTITY_HEADER_SECRET is required when IDENTITY_ADAPTER=trusted-header');
  }
  cached = parsed.data;
  return cached;
}
