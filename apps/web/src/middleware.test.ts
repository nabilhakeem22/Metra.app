import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, type NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routing } from './i18n/routing';

// The middleware does only the work a path needs (CPU relief, Workers Free
// plan): a client-page picture skips locale negotiation (Round D, R2), a client
// link takes the fast path, and the Supabase session refresh runs only when a
// session cookie is present. @supabase/ssr is mocked, so a call to
// createServerClient is exactly "the session refresh ran".

interface CookieToSet { name: string; value: string; options?: Record<string, unknown> }
interface CookieMethods { getAll(): unknown; setAll(cookies: CookieToSet[]): void }

const rotated = vi.hoisted(() => ({ cookies: [] as CookieToSet[] }));
const createServerClient = vi.hoisted(() =>
  vi.fn((_url: string, _key: string, options: { cookies: CookieMethods }) => ({
    auth: {
      getUser: async () => {
        if (rotated.cookies.length > 0) options.cookies.setAll(rotated.cookies);
        return { data: { user: null }, error: null };
      },
    },
  })),
);
vi.mock('@supabase/ssr', () => ({ createServerClient }));

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { middleware } = await import('./middleware');
const intlMiddleware = createIntlMiddleware(routing);

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`https://app.test${path}`, { headers: cookie ? { cookie } : {} });
}

function get(path: string, cookie?: string): Promise<NextResponse> {
  return middleware(request(path, cookie));
}

const FORWARDED_LOCALE = 'x-middleware-request-x-next-intl-locale';

/** The NEXT_LOCALE Set-Cookie attributes, Expires aside (it is a clock reading). */
function localeCookieAttributes(response: NextResponse): string | null {
  const header = response.headers.getSetCookie().find((line) => line.startsWith('NEXT_LOCALE='));
  if (!header) return null;
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => !/^expires=/i.test(part))
    .sort()
    .join('; ');
}

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  createServerClient.mockClear();
  rotated.cookies = [];
});

describe('middleware and client-page pictures', () => {
  it.each([['/ar-EG/d/tok/logo'], [`/ar-EG/d/tok/documents/${DOCUMENT_ID}`]])(
    "%s leaves an English visitor's locale cookie alone and keeps no-referrer",
    async (path) => {
      const response = await get(path, 'NEXT_LOCALE=en');
      expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined();
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('a picture path is a plain pass-through, with no session refresh', async () => {
    const response = await get('/ar-EG/d/tok/logo');
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('the client page itself still syncs the locale (control)', async () => {
    const response = await get('/ar-EG/d/tok', 'NEXT_LOCALE=en');
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('ar-EG');
  });
});

describe('the client-link fast path', () => {
  it('forwards the locale, sets the cookie and no-referrer, and never refreshes the session', async () => {
    const response = await get('/en/d/abc');
    expect(response.headers.get(FORWARDED_LOCALE)).toBe('en');
    expect(localeCookieAttributes(response)).toBe('Max-Age=31536000; NEXT_LOCALE=en; Path=/; SameSite=lax');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('link')).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('sets no cookie when NEXT_LOCALE already names the locale', async () => {
    const response = await get('/en/d/abc', 'NEXT_LOCALE=en');
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('skips the session refresh even when a session cookie is present', async () => {
    await get('/en/v/abc', 'sb-ref-auth-token=x');
    expect(createServerClient).not.toHaveBeenCalled();
  });

  const paths = ['/en/d/abc', '/ar-EG/p/xyz?x=1', '/en/c/t/sub'];
  const cookies: (string | undefined)[] = [undefined, 'equal', 'different'];
  it.each(paths.flatMap((path) => cookies.map((cookie) => [path, cookie] as const)))(
    '%s with NEXT_LOCALE %s matches next-intl on the locale header and cookie',
    async (path, cookieCase) => {
      const locale = path.split('/')[1];
      const cookie =
        cookieCase === undefined ? undefined : `NEXT_LOCALE=${cookieCase === 'equal' ? locale : locale === 'en' ? 'ar-EG' : 'en'}`;
      const fast = await get(path, cookie);
      const intl = intlMiddleware(request(path, cookie));
      expect(fast.headers.get(FORWARDED_LOCALE)).toBe(intl.headers.get(FORWARDED_LOCALE));
      expect(fast.headers.get(FORWARDED_LOCALE)).toBe(locale);
      expect(localeCookieAttributes(fast)).toBe(localeCookieAttributes(intl));
    },
  );

  it('a locale in the wrong case is not a client link: next-intl redirects it', async () => {
    const response = await get('/EN/d/abc');
    expect(response.status).toBe(307);
    expect(response.headers.get(FORWARDED_LOCALE)).toBeNull();
  });
});

describe('the session refresh runs only with a session cookie', () => {
  it('/login with no cookies redirects to the default locale without refreshing', async () => {
    const response = await get('/login');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/ar-EG/login');
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('a chunked session cookie refreshes once and the rotated cookie reaches the response', async () => {
    rotated.cookies = [{ name: 'sb-ref-auth-token.0', value: 'rotated', options: { path: '/' } }];
    const response = await get('/en/dashboard', 'sb-ref-auth-token.0=x');
    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(response.cookies.get('sb-ref-auth-token.0')?.value).toBe('rotated');
  });

  it('the PKCE code-verifier cookie alone is not a session', async () => {
    await get('/en/dashboard', 'sb-ref-auth-token-code-verifier=x');
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
