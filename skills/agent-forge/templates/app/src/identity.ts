/**
 * Identity seam. Authentication is a separate product: this app only learns *who* is
 * calling, through one function. Every run, memory row and trace is keyed by `userId`.
 *
 * - `local`: one user on this machine; the server binds 127.0.0.1 (scripts/start.mjs).
 * - `trusted-header`: an auth proxy in front sets `x-user-id` and `x-user-signature`
 *   = hex(HMAC-SHA256(IDENTITY_HEADER_SECRET, JSON.stringify([userId, rolesHeader]))); unsigned or mis-signed requests fail.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Resolved application identity and recognized roles; ownership checks use userId independently of operator visibility. */
export type Identity = { userId: string; roles: ReadonlyArray<'user' | 'admin'> };

/** Choose loopback-local identity or an externally protected signed-header adapter; authentication itself is out of scope. */
export type IdentityConfig = {
  adapter: 'local' | 'trusted-header';
  header: string;
  secret?: string | undefined;
};

/** Identity resolution failure mapped to HTTP 401 without accepting unsigned or forged caller state. */
export class IdentityError extends Error {
  readonly status = 401;
}

const LOCAL: Identity = { userId: 'local', roles: ['user', 'admin'] };

/** Signature the auth proxy must send for `userId`. */
export function signUserId(userId: string, secret: string, roles = 'user'): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify([userId, roles]))
    .digest('hex');
}

/**
 * Resolve the caller.
 * @throws IdentityError when a trusted header is missing or its signature does not match.
 * @example getIdentity(request.headers, { adapter: 'local', header: 'x-user-id' }) // { userId: 'local', ... }
 */
export function getIdentity(headers: Headers, config: IdentityConfig): Identity {
  if (config.adapter === 'local') return LOCAL;
  const userId = headers.get(config.header)?.trim();
  const signature = headers.get('x-user-signature') ?? '';
  if (!userId) throw new IdentityError(`missing ${config.header} header from the auth proxy`);
  if (!config.secret) throw new IdentityError('IDENTITY_HEADER_SECRET is not configured');
  const expected = Buffer.from(
    signUserId(userId, config.secret, headers.get('x-user-roles') ?? 'user'),
    'hex',
  );
  const given = Buffer.from(signature, 'hex');
  // Constant-time compare: a timing leak would let a caller forge signatures byte by byte.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new IdentityError('x-user-signature does not match x-user-id');
  }
  const roles = (headers.get('x-user-roles') ?? 'user')
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is 'user' | 'admin' => r === 'user' || r === 'admin');
  return { userId, roles: roles.length ? roles : ['user'] };
}
