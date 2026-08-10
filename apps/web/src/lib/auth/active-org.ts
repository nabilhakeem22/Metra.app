/** Cookie holding the user's currently-active org id. */
export const ACTIVE_ORG_COOKIE = 'metra_active_org';

/** httpOnly + Secure(prod) + SameSite=Lax. Server-set only, never client-trusted. */
export function activeOrgCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}
