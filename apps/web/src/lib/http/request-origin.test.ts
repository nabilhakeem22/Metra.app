import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// resolveRequestOrigin is server-only and reads next/headers; stub both so the
// pure resolution rules can be exercised outside a request scope.
vi.mock('server-only', () => ({}));
const headerMap = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => headerMap.get(k) ?? null }),
}));

const { resolveRequestOrigin } = await import('./request-origin');

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  headerMap.clear();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe('resolveRequestOrigin', () => {
  it('prefers NEXT_PUBLIC_APP_URL over the request host', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://metra.app';
    headerMap.set('host', 'metra-web.workers.dev');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.app');
  });

  it('strips a trailing slash and surrounding whitespace from the override', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '  https://metra.app/  ';
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.app');
  });

  it('ignores an empty override and falls back to the host header', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   ';
    headerMap.set('host', 'metra.example');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.example');
  });

  it('prefers x-forwarded-host over host', async () => {
    headerMap.set('host', 'internal.local');
    headerMap.set('x-forwarded-host', 'metra.example');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.example');
  });

  it('honours x-forwarded-proto', async () => {
    headerMap.set('host', 'localhost:3000');
    headerMap.set('x-forwarded-proto', 'http');
    await expect(resolveRequestOrigin()).resolves.toBe('http://localhost:3000');
  });

  it('defaults the scheme to https', async () => {
    headerMap.set('host', 'metra.example');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.example');
  });

  it('returns null rather than throwing when there is no host at all', async () => {
    await expect(resolveRequestOrigin()).resolves.toBeNull();
  });
});
