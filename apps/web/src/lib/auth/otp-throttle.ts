import 'server-only';
import { createHash } from 'node:crypto';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { callerIpBucket } from '@/lib/cf/caller-bucket';
import { consumeRateLimit, rateLimitBinding } from '@/lib/cf/rate-limit-binding';

// The sign-in code throttle (S2, go-live security), charged by both OTP routes
// BEFORE any Supabase call. Supabase sees the Worker's egress address, not the
// visitor, so its own per-IP limits are effectively one global bucket; these
// two Cloudflare Workers Rate Limiting bindings are the per-person control
// (ceilings in apps/web/wrangler.jsonc ONLY):
//   AUTH_OTP_IP_RATE_LIMITER          per step, keyed by the caller IP (IPv6 by
//                                     its /64, lib/cf/caller-bucket.ts);
//   AUTH_OTP_IDENTIFIER_RATE_LIMITER  per step, keyed by a sha256 prefix of the
//                                     identifier exactly as Supabase receives it
//                                     (canonical, otp-identifier.ts; the raw
//                                     value is never a key and never logged).
// Send and verify are separate buckets in both (the step prefixes the key).
// The IP bucket is charged first, and only a request it allows charges the
// identifier bucket. The identifier ceiling is ABOVE the IP ceiling (fix round
// T4, src/test/wrangler-rate-limits.ts pins it), so one source alone can never
// exhaust a named address's budget and lock its owner out.
//
// PER DATA CENTRE, NOT GLOBAL, like every binding. FAILURE MODES (owner
// decision, lib/cf/rate-limit-binding.ts): off-platform everything is allowed;
// a binding error, a timeout or a malformed answer is allowed and logged; a
// MISSING binding on Cloudflare refuses with a logged `generic`.

export type OtpStep = 'send' | 'verify';

export interface OtpThrottleRefusal {
  status: 429 | 500;
  body: ActionResult;
}

const OTP_SURFACE = 'sign-in';
const IP_BINDING = 'AUTH_OTP_IP_RATE_LIMITER';
const IDENTIFIER_BINDING = 'AUTH_OTP_IDENTIFIER_RATE_LIMITER';

/** The identifier's bucket: `identifier` is already canonical (otp-route.ts), the very string Supabase receives. */
function identifierKey(identifier: string): string {
  return createHash('sha256').update(identifier).digest('hex').slice(0, 32);
}

/** Charges one request to `key` in `binding`: true when it may go ahead. Throws on a missing binding. */
async function charge(binding: string, key: string): Promise<boolean> {
  return consumeRateLimit(rateLimitBinding(binding, OTP_SURFACE), key, binding);
}

function refusedBy(binding: string, step: OtpStep): OtpThrottleRefusal {
  console.warn('otp rate limit refused:', { binding, step });
  return { status: 429, body: err('otp_rate_limited') };
}

/**
 * null = go ahead. `identifier` is canonical (otp-identifier.ts). Charges the
 * IP bucket first; only when it allows, charges the identifier bucket. Never throws.
 */
export async function otpThrottleRefusal(
  request: Request,
  step: OtpStep,
  identifier: string,
): Promise<OtpThrottleRefusal | null> {
  try {
    if (!(await charge(IP_BINDING, `${step}:${callerIpBucket(request.headers) ?? 'anon'}`))) {
      return refusedBy(IP_BINDING, step);
    }
    const identifierAllowed = await charge(IDENTIFIER_BINDING, `${step}:${identifierKey(identifier)}`);
    return identifierAllowed ? null : refusedBy(IDENTIFIER_BINDING, step);
  } catch (error) {
    return { status: 500, body: unexpectedFailure('otp limiter missing', error) };
  }
}
