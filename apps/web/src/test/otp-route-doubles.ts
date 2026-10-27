import { vi } from 'vitest';

// TEST-ONLY. Stand-ins for what the sign-in code routes reach: the request
// cookie store (next/headers), the Supabase client (@supabase/ssr) and the
// membership probe's database (lib/db/context). A route test mocks those three
// modules with these, so the REAL route, core and failure mapping run.

interface CookieToSet { name: string; value: string; options?: Record<string, unknown> }
interface CookieMethods { setAll(cookies: CookieToSet[]): void }
interface AuthAnswer { data?: unknown; error: { code?: string; status?: number; message?: string } | null }

/** What the request's cookie store was asked to write (Next turns these into Set-Cookie). */
export const writtenCookies: CookieToSet[] = [];

export const cookieStore = {
  getAll: () => [],
  set: (name: string, value: string, options?: Record<string, unknown>) => writtenCookies.push({ name, value, options }),
};

/** The session cookies a successful verify makes Supabase write. */
export const SESSION_COOKIES: CookieToSet[] = [{ name: 'sb-ref-auth-token', value: 'base64-session', options: { path: '/' } }];

/** SESSION_COOKIES as the route writes them: hardened (lib/supabase/session-cookie.ts), off production so not Secure. */
export const WRITTEN_SESSION_COOKIES: CookieToSet[] = SESSION_COOKIES.map((cookie) => ({
  ...cookie,
  options: { path: '/', sameSite: 'lax', httpOnly: true, secure: false, maxAge: 2592000 },
}));

export const supabaseAuth = {
  signInWithOtp: vi.fn(async (_credentials: unknown): Promise<AuthAnswer> => ({ data: {}, error: null })),
  verifyOtp: vi.fn(async (_credentials: unknown): Promise<AuthAnswer> => ({ data: { user: { id: 'user-1' } }, error: null })),
};

export const createServerClient = vi.fn((_url: string, _key: string, options: { cookies: CookieMethods }) => ({
  auth: {
    signInWithOtp: supabaseAuth.signInWithOtp,
    verifyOtp: async (credentials: unknown) => {
      const answer = await supabaseAuth.verifyOtp(credentials);
      if (!answer.error) options.cookies.setAll(SESSION_COOKIES);
      return answer;
    },
  },
}));

/** The membership probe: one row per membership (its role), or a throw. */
export const withUserContext = vi.fn(async (_userId: string, _fn: unknown): Promise<unknown[]> => [{ role: 'owner' }]);

export function resetOtpRouteDoubles(): void {
  writtenCookies.length = 0;
  supabaseAuth.signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  supabaseAuth.verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  createServerClient.mockClear();
  withUserContext.mockReset().mockResolvedValue([{ role: 'owner' }]);
}

export const SITE = 'https://metra.app';

/** A POST to `path` as the login page sends it, with per-test header overrides. */
export function otpPost(path: string, body: string, headers: Record<string, string | undefined> = {}): Request {
  const merged: Record<string, string | undefined> = { origin: SITE, host: 'metra.app', 'content-type': 'application/json', ...headers };
  const present = Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return new Request(`${SITE}${path}`, { method: 'POST', headers: present, body });
}
