// The attributes every Supabase auth cookie is written with (S5, go-live
// security). PURE. Applied in BOTH setAll implementations (./server.ts and
// ./middleware.ts), the only places the session cookies are written.
//
// HttpOnly is safe: nothing in the browser reads the session (there is no
// createBrowserClient, and the only document.cookie readers read NEXT_LOCALE).

/** Owner decision D2: 30 days, rolling (the cookie is rewritten on each token refresh). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * What a Supabase auth cookie is written with. @supabase/ssr 0.5.2 forces
 * maxAge to 400 days whatever `cookieOptions` says, so the lifetime is imposed
 * here instead. A removal (maxAge 0) stays a removal. Secure mirrors
 * activeOrgCookieOptions(): on in production, off on a local http dev server.
 */
export function hardenedSessionCookieOptions(options: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...options,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: options?.maxAge === 0 ? 0 : SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}
