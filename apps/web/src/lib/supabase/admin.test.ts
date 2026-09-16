// The service-role client is built once per call and its `fetch` is the only
// place a Storage deadline can live — the SDK has no timeout option. So what is
// pinned here is that the client is built WITH one, and that a caller's own
// signal is not thrown away to make room for it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/secrets', () => ({
  runtimeSecret: (name: string) =>
    name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-role-key' : undefined,
}));
vi.mock('./config', () => ({ supabaseUrl: () => 'https://project.supabase.co' }));

type ClientOptions = { global?: { fetch?: typeof fetch } };
const createClient = vi.fn<(url: string, key: string, opts: ClientOptions) => object>();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts: ClientOptions) =>
    createClient(url, key, opts),
}));

import { createSupabaseAdminClient } from './admin';

/** The `fetch` the SDK would use, as configured. */
function configuredFetch(): typeof fetch {
  createSupabaseAdminClient();
  const [, , options] = createClient.mock.calls.at(-1) ?? [];
  const configured = (options as ClientOptions | undefined)?.global?.fetch;
  if (!configured) throw new Error('the admin client was built with no fetch override');
  return configured;
}

beforeEach(() => {
  createClient.mockReset();
  createClient.mockReturnValue({});
});

describe('createSupabaseAdminClient', () => {
  it('refuses to build without the service-role key', async () => {
    vi.resetModules();
    vi.doMock('@/lib/cf/secrets', () => ({ runtimeSecret: () => undefined }));
    const { createSupabaseAdminClient: unkeyed } = await import('./admin');
    expect(() => unkeyed()).toThrow('SUPABASE_SERVICE_ROLE_KEY is not set');
    vi.doUnmock('@/lib/cf/secrets');
    vi.resetModules();
  });

  it('gives every Storage request a deadline', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await configuredFetch()('https://project.supabase.co/storage/v1/bucket');
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    fetchSpy.mockRestore();
  });

  it('honours a caller-supplied signal alongside ours, never instead of it', async () => {
    // An SDK that cancels its own upload keeps that power; whichever fires first
    // wins. Replacing the signal would have silently disabled that cancellation.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const caller = new AbortController();
    await configuredFetch()('https://project.supabase.co/storage/v1/object', {
      method: 'POST',
      signal: caller.signal,
    });
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).not.toBe(caller.signal);
    caller.abort();
    expect(init?.signal?.aborted).toBe(true);
    fetchSpy.mockRestore();
  });
});
