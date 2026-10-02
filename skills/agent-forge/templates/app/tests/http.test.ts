import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { body, handle, json } from '@/server/http';

vi.mock('@/env', () => ({ env: () => ({ IDENTITY_ADAPTER: 'local', IDENTITY_HEADER: 'x-user-id' }) }));
afterEach(() => vi.restoreAllMocks());

describe('HTTP trust boundary', () => {
  it.each([null, undefined, 'synthetic non-error'])(
    'returns safe 500 for non-Error rejection %s',
    async (thrown) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const route = handle(async () => {
        throw thrown;
      });
      const response = await route(new Request('http://localhost/test'), {});
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'internal error' });
    },
  );
  it('does not log arbitrary exception contents or return internals', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = handle(async () => {
      throw new Error('synthetic-private-diagnostic');
    });
    const response = await route(new Request('http://localhost/test'), {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal error' });
    expect(log).toHaveBeenCalledWith(JSON.stringify({ msg: 'request failed', code: 'HTTP_UNEXPECTED' }));
  });
  it('rejects malformed JSON before work with a safe 400 response', async () => {
    const route = handle(async (request) => json(await body(request, z.object({ text: z.string() }))));
    const response = await route(new Request('http://localhost/test', { method: 'POST', body: '{bad' }), {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid JSON body' });
  });
  it('does not misclassify an internal SyntaxError as a definitive client refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = handle(async () => {
      throw new SyntaxError('internal parse after work');
    });
    expect((await route(new Request('http://localhost/test'), {})).status).toBe(500);
  });
});
