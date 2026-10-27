import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pageStaticInfo from 'next/dist/build/analysis/get-page-static-info';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// Go-live security fix rounds, T6 and F3. The matcher used to skip EVERY path
// with a dot, so a dotted page path (/en/d/xxxx.yyyy) rendered with no security
// or noindex header, and framed; then it skipped public/'s files by pattern, so
// a MISSING /nope.png still did. It now skips only Next's own files and the
// API. The files public/ ships are static assets on Cloudflare, served before
// the Worker (src/test/wrangler-assets.test.ts); in next dev and next start
// they come after the middleware, which must pass them through untouched. The
// matcher is compiled here by Next's own function, exactly as the build
// compiles it.

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

const pageHeaders = (profile: 'page' | 'token_page') => Object.entries(securityHeadersFor(profile, ['https://ref.supabase.test']));

describe('the middleware matcher (T6, F3)', () => {
  it('passes every file public/ ships, and the emitted robots and sitemap, through with no locale redirect', async () => {
    const served = [...publicPaths(), '/robots.txt', '/sitemap.xml'];
    expect(served).toContain('/fonts/Cairo-Variable.ttf');
    for (const path of served) {
      const response = await middleware(new NextRequest(`https://app.test${path}`));
      expect([path, response.headers.get('location'), response.headers.get('x-middleware-next')]).toEqual([path, null, '1']);
    }
  });

  it.each(['/nope.png', '/nope.html', '/fonts/missing.ttf', '/og/missing.png', '/landing/missing.webp', '/manifest.webmanifest'])(
    'runs on the missing file %s and gives its 404 the page security set and noindex',
    async (path) => {
      expect(runsMiddleware(path)).toBe(true);
      const response = await middleware(new NextRequest(`https://app.test${path}`));
      for (const [name, value] of pageHeaders('page')) expect(response.headers.get(name), name).toBe(value);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    },
  );

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
    for (const [name, value] of pageHeaders('token_page')) expect(response.headers.get(name), name).toBe(value);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
