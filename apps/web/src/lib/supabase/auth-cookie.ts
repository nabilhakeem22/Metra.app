// Does this request carry a Supabase session? PURE.
//
// @supabase/ssr stores the session as `sb-<project-ref>-auth-token`, split into
// `.0`, `.1`, ... chunks when it is large. The PKCE `-code-verifier` cookie is
// not a session, so it does not count. The middleware skips the session refresh
// (createServerClient + getUser) when there is no session to refresh.
const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

export function hasSupabaseAuthCookie(cookies: { getAll(): { name: string }[] }): boolean {
  return cookies.getAll().some((cookie) => SUPABASE_AUTH_COOKIE.test(cookie.name));
}
