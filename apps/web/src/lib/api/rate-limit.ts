import 'server-only';
import { createHash } from 'node:crypto';
import { callerIpBucket } from '@/lib/cf/caller-bucket';
import { consumeRateLimit, rateLimitBinding } from '@/lib/cf/rate-limit-binding';

// Cloudflare Workers Rate Limiting bindings for the Public API (v1). Two buckets:
//   API_RATE_LIMITER          100 requests / 60s per resolved KEY (post-auth).
//   API_PREAUTH_RATE_LIMITER  300 requests / 60s per CALLER (pre-auth).
// The pre-auth bucket exists because key resolution costs a database round trip:
// without it an unauthenticated flood of garbage bearer tokens is a free way to
// hammer the database, and the per-key limiter can never see it because there is
// no key. Off-platform (Node/Vitest, `next dev` on Node) the bindings are absent,
// so this degrades to ALLOW: tests and local dev are never rate-limited. The
// binding lookup and the fail-open / fail-closed rule are in
// lib/cf/rate-limit-binding.ts.
//
// BOTH BUDGETS ARE PER DATA CENTRE, NOT GLOBAL. A Workers Rate Limiting binding
// counts within the colo that served the request, so a caller spread across k
// colos gets k x the configured ceiling: the pre-auth cap is k x 300/min, not
// 300/min. That is still a bound on database work per colo, which is what this
// exists for, but it is NOT a global quota and must not be quoted as one.

export const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (for the Retry-After header). */
  retryAfterSeconds: number;
}

export type RateLimiter = (keyId: string) => Promise<RateLimitResult>;
export type PreAuthRateLimiter = (req: Request) => Promise<RateLimitResult>;

const ALLOW: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };
const DENY: RateLimitResult = {
  allowed: false,
  retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
};

/**
 * The pre-auth bucket key. The caller IP (lib/cf/caller-bucket.ts: Cloudflare's
 * cf-connecting-ip, an IPv6 caller by its /64) when there is one. Without it we
 * fall back to a hash of the raw Authorization header (hashed so no token
 * material is ever used as a key), and finally to a shared 'anon' bucket,
 * deliberately shared, because an unidentifiable caller getting a private
 * budget is the hole we are closing.
 */
function preAuthBucket(req: Request): string {
  const callerIp = callerIpBucket(req.headers);
  if (callerIp) return callerIp;
  const authorization = req.headers.get('authorization');
  if (authorization) {
    return createHash('sha256').update(authorization).digest('hex').slice(0, 16);
  }
  return 'anon';
}

const API_SURFACE = 'the Public API';

/** One bucket's verdict as the API pipeline reads it. */
async function consume(bindingName: string, key: string): Promise<RateLimitResult> {
  return (await consumeRateLimit(rateLimitBinding(bindingName, API_SURFACE), key, bindingName)) ? ALLOW : DENY;
}

// Both are `async` so a missing-binding throw surfaces as a REJECTED promise
// rather than a synchronous throw at the call site, which is what every caller
// (and every test) awaits.

/** Per-KEY bucket: each API key gets its own budget once it has been resolved. */
export const cloudflareRateLimiter: RateLimiter = async (keyId) =>
  consume('API_RATE_LIMITER', keyId);

/** Per-CALLER bucket, charged BEFORE key resolution touches the database. */
export const cloudflarePreAuthRateLimiter: PreAuthRateLimiter = async (req) =>
  consume('API_PREAUTH_RATE_LIMITER', preAuthBucket(req));
