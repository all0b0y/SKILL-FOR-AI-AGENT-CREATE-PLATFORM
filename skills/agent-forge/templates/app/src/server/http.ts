/**
 * Route-handler plumbing: resolves identity, validates the body, maps known errors to HTTP
 * status codes with a message the UI can show. Unknown errors become 500 without internals.
 */
import { ZodError, type z } from 'zod';
import { env } from '@/env';
import { getIdentity, type Identity, IdentityError } from '@/identity';

/** Resolve request identity from validated application settings; signed-header failures propagate as IdentityError. */
export function identityOf(request: Request): Identity {
  const e = env();
  return getIdentity(request.headers, {
    adapter: e.IDENTITY_ADAPTER,
    header: e.IDENTITY_HEADER,
    secret: e.IDENTITY_HEADER_SECRET,
  });
}

class InvalidBodyError extends Error {
  readonly status = 400;
}

/** Parse request JSON and apply the supplied schema/defaults. Malformed JSON is a safe 400; schema failures propagate as ZodError. */
export async function body<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new InvalidBodyError('invalid JSON body');
  }
  return schema.parse(data);
}

/** Construct a JSON response with an explicit status, defaulting to HTTP 200. */
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Wrap a handler: identity + error mapping. */
export function handle<C>(fn: (request: Request, who: Identity, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(request, identityOf(request), ctx);
    } catch (e) {
      if (e instanceof ZodError)
        return json({ error: 'invalid request', issues: e.issues.map((i) => i.message) }, 400);
      if (e instanceof IdentityError) return json({ error: e.message }, 401);
      if (e instanceof Error) {
        const status = (e as Error & { status?: unknown }).status;
        if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500)
          return json({ error: e.message }, status);
      }
      // Provider/DB exceptions may embed bodies or credentials. Log only stable metadata.
      console.error(JSON.stringify({ msg: 'request failed', code: 'HTTP_UNEXPECTED' }));
      return json({ error: 'internal error' }, 500);
    }
  };
}
