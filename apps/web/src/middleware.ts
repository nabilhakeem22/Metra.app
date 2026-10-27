import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { isPortalPicturePath } from './lib/engagements/portal-picture-path';
import { withSecurityHeaders } from './lib/http/security-headers';
import { clientLinkLocaleOf, clientLinkResponse } from './lib/middleware/client-link';
import { responseHeadersFor } from './lib/middleware/response-headers';
import { hasSupabaseAuthCookie } from './lib/supabase/auth-cookie';
import { updateSession } from './lib/supabase/middleware';

const intlMiddleware = createIntlMiddleware(routing);

// Every Worker request has a 10 ms CPU budget on the Workers Free plan, so the
// middleware does only the work a path needs, cheapest first:
// 1. A client-page picture is always fetched under one fixed locale segment, so
//    it skips locale negotiation: it must never reset the visitor's locale
//    cookie (lib/engagements/portal-picture-path.ts).
// 2. A client link names its locale in the path and reads no session: the fast
//    path forwards the locale and syncs the cookie (lib/middleware/client-link.ts).
// 3. Everything else: i18n (locale detection + redirect), then the Supabase
//    session refresh, only when there is a session cookie to refresh.
// Every response then gets the path's headers: the security set
// (lib/http/security-headers.ts: HSTS, frame and sniffing rules, the CSP, and
// no-referrer on the token links /c /d /invite /p /v), then the SEO set
// (responseHeadersFor: noindex everywhere but the landing pages).
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const response = withSecurityHeaders(await routeResponse(request), pathname);
  for (const [name, value] of Object.entries(responseHeadersFor(pathname))) {
    response.headers.set(name, value);
  }
  return response;
}

async function routeResponse(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPortalPicturePath(pathname)) return NextResponse.next();
  const clientLinkLocale = clientLinkLocaleOf(pathname);
  if (clientLinkLocale) return clientLinkResponse(request, clientLinkLocale);
  const response = intlMiddleware(request);
  return hasSupabaseAuthCookie(request.cookies) ? updateSession(request, response) : response;
}

export const config = {
  // Everything except API routes, Next's own files and the files public/ ships
  // (its asset folders, and top-level files by extension). A dotted path
  // anywhere else (/en/d/x.y, /nope.xyz) is a page: it gets the security and
  // noindex headers. src/middleware-matcher.test.ts compiles this with Next's
  // own matcher and checks it against every file in public/.
  matcher: ['/((?!api|_next|_vercel|fonts/|landing/|og/|[^/]+\\.(?:ico|png|svg|txt|xml|html|webmanifest)$).*)'],
};
