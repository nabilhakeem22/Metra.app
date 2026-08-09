import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from './config';

/**
 * Refreshes the Supabase auth session and writes rotated cookies onto the given
 * response (which the i18n middleware already produced). Must run in middleware
 * so httpOnly cookies stay fresh.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[],
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the user to trigger a token refresh when needed. Fail OPEN: if GoTrue
  // is slow or errors, proceed WITHOUT a refreshed session rather than throwing
  // a 500 on every page. Auth is still enforced server-side by requireOrg().
  // getUser() takes no AbortSignal, so race it against a timeout.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth-getUser-timeout')), 4000);
      }),
    ]);
  } catch {
    // timeout or transport error — skip the refresh for this request.
  } finally {
    if (timer) clearTimeout(timer);
  }

  return response;
}
