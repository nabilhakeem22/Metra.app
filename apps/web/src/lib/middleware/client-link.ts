import { NextResponse, type NextRequest } from 'next/server';
import { LOCALES, LOCALE_COOKIE_NAME, type Locale } from '@/i18n/routing';

// The client-link fast path of the middleware. PURE: no Supabase, no next-intl
// middleware.
//
// A client link (/{locale}/c|d|p|v/{token}...) already names its locale in the
// path, and none of its server code reads the Supabase session, so the full
// next-intl negotiation and the session refresh are CPU spent for nothing on
// the Workers Free plan's 10 ms budget. This keeps exactly what those pages
// need from next-intl: the forwarded locale request header (without it
// i18n/request.ts falls back to ar-EG and an English link renders in Arabic)
// and the NEXT_LOCALE cookie sync (the documents route reads that cookie). It
// drops the `Link` hreflang header: these URLs are noindex and disallowed.

/** The request header next-intl's server functions read the locale from. */
const LOCALE_REQUEST_HEADER = 'X-NEXT-INTL-LOCALE';

/** One year, the attributes next-intl 3.26.5 `syncCookie` writes. */
const LOCALE_COOKIE_MAX_AGE_SECONDS = 31536000;

// Case-sensitive on purpose: `/EN/d/x` is not a known locale, so it falls
// through to next-intl, which redirects it as before.
const CLIENT_LINK_PATH = new RegExp(`^/(${LOCALES.join('|')})/(?:c|d|p|v)/[^/]+(?:/.*)?$`);

/** The locale a client-link path is under, or null when the path is not a client link. */
export function clientLinkLocaleOf(pathname: string): Locale | null {
  const match = CLIENT_LINK_PATH.exec(pathname);
  return match ? (match[1] as Locale) : null;
}

/** Pass a client-link request through with its locale forwarded and the locale cookie in sync. */
export function clientLinkResponse(request: NextRequest, locale: Locale): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(LOCALE_REQUEST_HEADER, locale);
  const response = NextResponse.next({ request: { headers } });
  if (request.cookies.get(LOCALE_COOKIE_NAME)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE_NAME, locale, { sameSite: 'lax', maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS });
  }
  return response;
}

/** Keep a share token in the path from riding a Referer header to another origin. */
export function withNoReferrer(response: NextResponse): NextResponse {
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
