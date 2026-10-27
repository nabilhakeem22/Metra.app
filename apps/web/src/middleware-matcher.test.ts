import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pageStaticInfo from 'next/dist/build/analysis/get-page-static-info';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// Go-live security fix round, T6. The matcher used to skip EVERY path with a
// dot, so a dotted page path (/en/d/xxxx.yyyy) rendered with no security or
// noindex header, and framed. It now skips only Next's own files, the API and
// the files public/ ships. The matcher is compiled here by Next's own
// function, exactly as the build compiles it.

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { config, middleware } = await import('./middleware');
const { securityHeadersFor } = await import('./lib/http/security-headers');

// The function the build compiles `config.matcher` with; Next ships it untyped.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matcher: string[], nextConfig: object) => Array<{ regexp: string }>;
};

const PUBLIC_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public');
const MATCHERS = getMiddlewareMatchers(config.matcher, {}).map((matcher) => new RegExp(matcher.regexp));
const runsMiddleware = (path: string) => MATCHERS.some((matcher) => matcher.test(path));

/** Every file under public/ as the URL path it is served at. `_headers` is configuration, never served. */
function publicPaths(): string[] {
  return readdirSync(PUBLIC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '_headers')
    .map((entry) => `/${relative(PUBLIC_DIR, join(entry.parentPath, entry.name)).split(sep).join('/')}`);
}

describe('the middleware matcher (T6)', () => {
  it('skips every file public/ ships, and the robots and sitemap files the build emits', () => {
    const served = [...publicPaths(), '/robots.txt', '/sitemap.xml'];
    expect(served).toContain('/fonts/Cairo-Variable.ttf');
    expect(served.filter(runsMiddleware)).toEqual([]);
  });

  it.each(['/_next/static/chunks/main.js', '/_next/image', '/api/v1/projects', '/api/auth/otp/send'])('skips %s', (path) => {
    expect(runsMiddleware(path)).toBe(false);
  });

  it.each([
    '/en/d/xxxxxxx.yyyy',
    '/ar-EG/c/a.b',
    '/en/v/a.b',
    '/en/p/a.b',
    '/en/invite/a.b',
    '/en/projects/x.y',
    '/en/d/picture.png',
    '/nope.xyz',
    '/en',
    '/en/dashboard',
  ])('runs on %s', (path) => {
    expect(runsMiddleware(path)).toBe(true);
  });

  it('gives a dotted token path the token-page security set and noindex', async () => {
    const response = await middleware(new NextRequest('https://app.test/en/d/xxxxxxx.yyyy'));
    for (const [name, value] of Object.entries(securityHeadersFor('token_page', ['https://ref.supabase.test']))) {
      expect(response.headers.get(name), name).toBe(value);
    }
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
