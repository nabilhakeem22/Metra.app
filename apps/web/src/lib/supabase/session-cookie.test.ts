import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// S5 (go-live security): every Supabase auth cookie is HttpOnly, SameSite=Lax,
// Path=/, 30 days, and Secure in production, whichever of the two setAll paths
// writes it; a removal stays Max-Age=0. @supabase/ssr is replaced by a client
// that writes the cookies a sign-in (or a sign-out) would.

type CookieWrite = { name: string; value: string; options?: Record<string, unknown> };
type CookieAdapter = { setAll(cookies: CookieWrite[]): void };
const ssr = vi.hoisted(() => ({ writes: [] as CookieWrite[] }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieAdapter }) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll(ssr.writes);
        return { data: { user: null } };
      },
    },
    cookies: options.cookies,
  }),
}));
vi.mock('./config', () => ({ supabaseUrl: () => 'https://ref.supabase.test', supabaseAnonKey: () => 'anon' }));
const cookieStore = vi.hoisted(() => ({ set: vi.fn(), getAll: () => [] }));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));

const { hardenedSessionCookieOptions, SESSION_COOKIE_MAX_AGE_SECONDS } = await import('./session-cookie');
const { updateSession } = await import('./middleware');
const { createSupabaseServerClient } = await import('./server');

/** What @supabase/ssr 0.5.2 hands setAll: its defaults, 400 days, not HttpOnly. */
const SSR_DEFAULTS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 };
const SIGN_IN: CookieWrite[] = [
  { name: 'sb-ref-auth-token.0', value: 'a', options: SSR_DEFAULTS },
  { name: 'sb-ref-auth-token.1', value: 'b', options: SSR_DEFAULTS },
];

async function middlewareSetCookies(): Promise<string[]> {
  const request = new NextRequest('https://app.metra.test/en/dashboard');
  const response = await updateSession(request, NextResponse.next());
  return response.headers.getSetCookie();
}

beforeEach(() => {
  ssr.writes = SIGN_IN;
  cookieStore.set.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hardenedSessionCookieOptions', () => {
  it('is 30 days', () => {
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(2592000);
  });

  it('overrides the 400-day lifetime and the missing HttpOnly', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(hardenedSessionCookieOptions(SSR_DEFAULTS)).toEqual({
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
      maxAge: 2592000,
    });
  });

  it('is not Secure off production (a local http dev server)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(hardenedSessionCookieOptions(undefined).secure).toBe(false);
  });

  it('keeps a removal a removal', () => {
    expect(hardenedSessionCookieOptions({ ...SSR_DEFAULTS, maxAge: 0 }).maxAge).toBe(0);
  });
});

describe('the middleware session refresh', () => {
  it('writes every auth cookie hardened', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const setCookies = await middlewareSetCookies();
    expect(setCookies).toHaveLength(2);
    for (const line of setCookies) {
      expect(line).toMatch(/^sb-ref-auth-token\.\d=/);
      expect(line).toContain('Path=/');
      expect(line).toContain('Max-Age=2592000');
      expect(line).toMatch(/HttpOnly/i);
      expect(line).toMatch(/SameSite=Lax/i);
      expect(line).toMatch(/Secure/i);
    }
  });

  it('still writes Max-Age=0 on a sign-out', async () => {
    ssr.writes = [{ name: 'sb-ref-auth-token', value: '', options: { ...SSR_DEFAULTS, maxAge: 0 } }];
    const [line] = await middlewareSetCookies();
    expect(line).toContain('Max-Age=0');
  });
});

describe('the server-side client', () => {
  it('writes every auth cookie hardened', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const client = (await createSupabaseServerClient()) as unknown as { auth: { getUser(): Promise<unknown> } };
    await client.auth.getUser();
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    for (const [, , options] of cookieStore.set.mock.calls) {
      expect(options).toEqual({ path: '/', sameSite: 'lax', httpOnly: true, secure: true, maxAge: 2592000 });
    }
  });
});
