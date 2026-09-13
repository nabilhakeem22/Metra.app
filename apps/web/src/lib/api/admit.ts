import 'server-only';
// ADMISSION for the Public API (v1): everything that can turn a caller away
// before a single row is read. Split out of pipeline.ts so that file is about
// serving a request and this one is about refusing it — the two change for
// entirely different reasons (a new budget, versus a new error mapping).
import { can } from '@/lib/permissions/can';
import type { Capability, PermissionAction } from '@/lib/permissions/roles';
import { resolveApiKey, type ApiPrincipal } from '@/lib/api-keys/resolve';
import { problemResponse } from './errors';
import {
  cloudflarePreAuthRateLimiter,
  cloudflareRateLimiter,
  RATE_LIMIT_WINDOW_SECONDS,
  type PreAuthRateLimiter,
  type RateLimiter,
  type RateLimitResult,
} from './rate-limit';

export interface AdmissionOptions {
  /**
   * The §2.2 capability this route reads, and the action to check it with.
   * REQUIRED and deliberately not defaulted: a route that forgets to declare
   * one is a route with no authorization, so it must not compile.
   */
  capability: Capability;
  action: PermissionAction;
  /** Injectable for tests; default to the Cloudflare Rate Limiting bindings. */
  rateLimiter?: RateLimiter;
  preAuthRateLimiter?: PreAuthRateLimiter;
}

/** 429 + Retry-After, built identically for both buckets. */
function rateLimitedResponse(rate: RateLimitResult): Response {
  return problemResponse('rate-limited', {
    detail: 'API rate limit exceeded.',
    headers: {
      'retry-after': String(rate.retryAfterSeconds || RATE_LIMIT_WINDOW_SECONDS),
    },
  });
}

/** The raw `Authorization: Bearer …` credential, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Admit a caller, in the one order that keeps every step cheap: the pre-auth
 * budget (charged BEFORE the key lookup touches the database), the bearer key
 * itself, that key's own budget, and finally the role's capability — which runs
 * BEFORE any org read, so a refused role costs no database work either.
 *
 * Returns the admitted principal, or the Response that refuses the request.
 */
export async function admitApiCaller(
  req: Request,
  options: AdmissionOptions,
): Promise<ApiPrincipal | Response> {
  const preAuth = await (options.preAuthRateLimiter ?? cloudflarePreAuthRateLimiter)(
    req,
  );
  if (!preAuth.allowed) return rateLimitedResponse(preAuth);

  const principal = await resolveApiKey(bearerToken(req));
  if (!principal) {
    return problemResponse('unauthorized', {
      detail: 'A valid Bearer API key is required.',
    });
  }

  const rate = await (options.rateLimiter ?? cloudflareRateLimiter)(principal.keyId);
  if (!rate.allowed) return rateLimitedResponse(rate);

  if (!can(principal.role, options.capability, options.action)) {
    return problemResponse('forbidden', {
      detail: 'The role behind this API key may not read this resource.',
    });
  }
  return principal;
}
