import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { isPortalPicturePath } from './lib/engagements/portal-picture-path';
import { clientLinkLocaleOf, clientLinkResponse, withNoReferrer } from './lib/middleware/client-link';
import { hasSupabaseAuthCookie } from './lib/supabase/auth-cookie';
import { updateSession } from './lib/supabase/middleware';

const intlMiddleware = createIntlMiddleware(routing);

// Tokenized client surfaces carry the share token in the URL path (/{locale}/d|p|c|v/{token}).
// Send `Referrer-Policy: no-referrer` on those routes so the token can never ride a
// Referer header to a third party if the page ever links/loads an external origin.
// Purely additive header: it does not touch routing or auth control flow.
const TOKEN_ROUTE = /\/(d|p|c|v)\/[^/]+/;

// Every Worker request has a 10 ms CPU budget on the Workers Free plan, so the
// middleware does only the work a path needs, cheapest first:
// 1. A client-page picture is always fetched under one fixed locale segment, so
//    it skips locale negotiation: it must never reset the visitor's locale
//    cookie (lib/engagements/portal-picture-path.ts).
// 2. A client link names its locale in the path and reads no session: the fast
//    path forwards the locale and syncs the cookie (lib/middleware/client-link.ts).
// 3. Everything else: i18n (locale detection + redirect), then the Supabase
//    session refresh, only when there is a session cookie to refresh.
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPortalPicturePath(pathname)) return withNoReferrer(NextResponse.next());
  const clientLinkLocale = clientLinkLocaleOf(pathname);
  if (clientLinkLocale) return withNoReferrer(clientLinkResponse(request, clientLinkLocale));
  const response = intlMiddleware(request);
  const result = hasSupabaseAuthCookie(request.cookies) ? await updateSession(request, response) : response;
  return TOKEN_ROUTE.test(pathname) ? withNoReferrer(result) : result;
}

export const config = {
  // Everything except API routes, static assets and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
