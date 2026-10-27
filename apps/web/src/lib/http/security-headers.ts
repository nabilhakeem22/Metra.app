import type { NextResponse } from 'next/server';
import { isPortalPicturePath } from '@/lib/engagements/portal-picture-path';
import { TOKEN_SEGMENTS } from '@/lib/seo/private-paths';
import { ENFORCED_CSP, reportOnlyCsp } from './content-security-policy';

// THE OWNER of every security response header (S6, go-live security). PURE, no
// `server-only`: the middleware imports it.
//   - this module: every security header value, and which profile a path gets;
//   - lib/http/content-security-policy.ts: the CSP directive data;
//   - lib/seo/robots-header.ts (SEO): X-Robots-Tag, not touched here;
//   - src/middleware.ts: the ONE hook applying both to every Worker page response;
//   - public/_headers: the ONE static-asset file; its `/*` block must equal
//     STATIC_ASSET_SECURITY_HEADERS (src/test/static-headers.test.ts).
// /api/* is not covered (the middleware matcher excludes it); the Public API's
// own two headers are in lib/api/errors.ts.
//
// CPU (Workers Free, 10 ms): the header lists are built once per isolate; a
// request costs one path split and a few Headers.set calls.

export type SecurityHeaderProfile = 'page' | 'token_page' | 'file';

const TOKEN_SEGMENT_SET: ReadonlySet<string> = new Set(TOKEN_SEGMENTS);

/** 'file' = isPortalPicturePath(pathname) (client-page pictures and documents, possibly inline PDFs);
 *  'token_page' = /{locale}/{segment}/... where segment is in TOKEN_SEGMENTS (c, d, invite, p, v),
 *  matched as a whole path segment; anything else = 'page'. */
export function securityHeaderProfileOf(pathname: string): SecurityHeaderProfile {
  if (isPortalPicturePath(pathname)) return 'file';
  return TOKEN_SEGMENT_SET.has(pathname.split('/')[2] ?? '') ? 'token_page' : 'page';
}

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()';

export function securityHeadersFor(profile: SecurityHeaderProfile, extraOrigins: readonly string[]): Readonly<Record<string, string>> {
  const always = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // A token in the path must never ride a Referer header to another site.
    'Referrer-Policy': profile === 'page' ? 'strict-origin-when-cross-origin' : 'no-referrer',
  };
  // A picture or document response (possibly an inline PDF) gets no CSP or
  // Permissions-Policy: object-src 'none' on a top-level PDF risks Chrome's viewer.
  if (profile === 'file') return always;
  return {
    ...always,
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Content-Security-Policy': ENFORCED_CSP,
    'Content-Security-Policy-Report-Only': reportOnlyCsp(extraOrigins),
  };
}

/** securityHeadersFor('page', []): what the public/_headers block for /* must say. */
export const STATIC_ASSET_SECURITY_HEADERS: Readonly<Record<string, string>> = securityHeadersFor('page', []);

/** The Supabase project origin (inlined at build), or none when unset or unparsable; never a throw. */
function supabaseOrigins(): string[] {
  try {
    return [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin];
  } catch {
    return [];
  }
}

const WORKER_ORIGINS = supabaseOrigins();
const HEADERS_BY_PROFILE: Readonly<Record<SecurityHeaderProfile, ReadonlyArray<[string, string]>>> = {
  page: Object.entries(securityHeadersFor('page', WORKER_ORIGINS)),
  token_page: Object.entries(securityHeadersFor('token_page', WORKER_ORIGINS)),
  file: Object.entries(securityHeadersFor('file', WORKER_ORIGINS)),
};

/** Sets the profile headers on the response (maps built once per isolate; per request only Headers.set). Returns the same object. */
export function withSecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  for (const [name, value] of HEADERS_BY_PROFILE[securityHeaderProfileOf(pathname)]) response.headers.set(name, value);
  return response;
}
