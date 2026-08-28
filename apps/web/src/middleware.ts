import createIntlMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { updateSession } from './lib/supabase/middleware';

const intlMiddleware = createIntlMiddleware(routing);

// Tokenized client surfaces carry the share token in the URL path (/{locale}/d|p|c|v/{token}).
// Send `Referrer-Policy: no-referrer` on those routes so the token can never ride a
// Referer header to a third party if the page ever links/loads an external origin.
// Purely additive header — does not touch routing or auth control flow.
const TOKEN_ROUTE = /\/(d|p|c|v)\/[^/]+/;

export async function middleware(request: NextRequest) {
  // i18n first (locale detection + redirect), then refresh Supabase cookies on it.
  const response = intlMiddleware(request);
  const result = await updateSession(request, response);
  if (TOKEN_ROUTE.test(request.nextUrl.pathname)) {
    result.headers.set('Referrer-Policy', 'no-referrer');
  }
  return result;
}

export const config = {
  // Everything except API routes, static assets and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
