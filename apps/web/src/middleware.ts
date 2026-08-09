import createIntlMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { updateSession } from './lib/supabase/middleware';

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // i18n first (locale detection + redirect), then refresh Supabase cookies on it.
  const response = intlMiddleware(request);
  return updateSession(request, response);
}

export const config = {
  // Everything except API routes, static assets and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
