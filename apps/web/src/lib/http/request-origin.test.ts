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
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  headerMap.clear();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  vi.stubEnv('NODE_ENV', originalNodeEnv ?? 'test');
  vi.unstubAllEnvs();
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

  it('treats an empty x-forwarded-proto as absent and uses https', async () => {
    headerMap.set('host', 'metra.example');
    headerMap.set('x-forwarded-proto', '');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.example');
  });

  it('an empty x-forwarded-host does not shadow a valid host', async () => {
    headerMap.set('host', 'metra.example');
    headerMap.set('x-forwarded-host', '');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.example');
  });

  it('returns null when the only host is whitespace', async () => {
    headerMap.set('host', '   ');
    await expect(resolveRequestOrigin()).resolves.toBeNull();
  });

  it('strips every trailing slash from the override', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://metra.app//';
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.app');
  });

  it('skips an empty leading entry in a forwarded list', async () => {
    headerMap.set('host', 'internal.local');
    headerMap.set('x-forwarded-host', ', real.example');
    headerMap.set('x-forwarded-proto', ', https');
    await expect(resolveRequestOrigin()).resolves.toBe('https://real.example');
  });

  it('takes the leftmost entry of a forwarded list', async () => {
    headerMap.set('x-forwarded-host', 'a.example, b.example');
    headerMap.set('x-forwarded-proto', 'http, https');
    await expect(resolveRequestOrigin()).resolves.toBe('http://a.example');
  });

  // The Host header is attacker-controlled. In production an unset
  // NEXT_PUBLIC_APP_URL is a deployment defect, not a reason to email a link to
  // whatever host the request claimed.
  it('in PRODUCTION with no override, returns null even with a valid Host', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    headerMap.set('host', 'attacker.example');
    headerMap.set('x-forwarded-host', 'attacker.example');
    await expect(resolveRequestOrigin()).resolves.toBeNull();
  });

  it('in PRODUCTION the override still wins', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.NEXT_PUBLIC_APP_URL = 'https://metra.app';
    headerMap.set('host', 'attacker.example');
    await expect(resolveRequestOrigin()).resolves.toBe('https://metra.app');
  });
});
