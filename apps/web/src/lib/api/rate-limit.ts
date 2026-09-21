import 'server-only';
import { createHash } from 'node:crypto';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';
import { loggableFailure } from '@/lib/actions/loggable-failure';

// Cloudflare Workers Rate Limiting bindings for the Public API (v1). Two buckets:
//   API_RATE_LIMITER          100 requests / 60s per resolved KEY (post-auth).
//   API_PREAUTH_RATE_LIMITER  300 requests / 60s per CALLER (pre-auth).
// The pre-auth bucket exists because key resolution costs a database round trip:
// without it an unauthenticated flood of garbage bearer tokens is a free way to
// hammer the database, and the per-key limiter can never see it because there is
// no key. Off-platform (Node/Vitest, `next dev` on Node) the bindings are absent,
// so this degrades to ALLOW — tests and local dev are never rate-limited.
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

/** The Cloudflare Rate Limiting binding shape (subset used here). */
interface CloudflareRateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The named binding, or null OFF-platform. On Cloudflare a missing binding is a
 * deployment defect, not a degraded mode: silently returning null there would
 * serve the Public API with no limit at all, so it throws instead.
 */
function binding(name: string): CloudflareRateLimit | null {
  // Never reachable in production: off-platform means Node/Vitest/`next dev`.
  if (!isCloudflareRuntime()) return null;
  const env = cfEnv() as unknown as Record<string, CloudflareRateLimit | undefined>;
  const limiter = env[name];
  if (!limiter) {
    throw new Error(
      `Rate limiting binding ${name} is missing on the Cloudflare runtime. ` +
        'Add it to apps/web/wrangler.jsonc. Refusing to serve the Public API unlimited.',
    );
  }
  return limiter;
}

/**
 * Runs one bucket.
 *
 * OWNER DECISION, recorded so it is not silently reversed by whoever next reads
 * this and thinks it looks like a bug. The two failures are DIFFERENT and are
 * handled differently ON PURPOSE:
 *
 *  - A binding ERROR fails OPEN. An availability blip in Cloudflare's limiter
 *    would otherwise take the entire Public API down for every caller, and a
 *    few seconds of unmetered traffic is a smaller harm than a total outage.
 *    The blip is logged, so it is visible rather than merely survived.
 *  - A MISSING binding fails CLOSED, and never reaches this function at all:
 *    `binding()` throws and the request 500s. That is not an availability
 *    problem, it is a misdeployed Worker, and serving the API unlimited because
 *    somebody forgot a line in wrangler.jsonc is not a trade worth making.
 *
 * The same sentence is in docs/API.md, for the reader who is looking at the
 * behaviour rather than at the code.
 */
async function consume(
  limiter: CloudflareRateLimit | null,
  key: string,
): Promise<RateLimitResult> {
  if (!limiter) return ALLOW;
  try {
    const { success } = await limiter.limit({ key });
    return success ? ALLOW : DENY;
  } catch (error) {
    console.error('rate limiter error (failing open):', loggableFailure(error));
    return ALLOW;
  }
}

const IPV6_GROUPS = 8;
const HEXTET_RE = /^[0-9a-f]{1,4}$/;

/**
 * The eight hextets of an IPv6 address, lower-cased with leading zeros stripped.
 *
 * `::` stands for however many all-zero groups are missing, so it has to be
 * expanded before any two addresses can be compared: `2001:db8::1` and
 * `2001:0db8:0:0:0:0:0:2` share a /64 and neither spells it the same way.
 * Returns null for anything this cannot expand — including an embedded IPv4.
 */
function expandIpv6(address: string): string[] | null {
  const [head, tail, extra] = address.toLowerCase().split('::');
  if (extra !== undefined) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? 0 : IPV6_GROUPS - left.length - right.length;
  if (tail === undefined ? left.length !== IPV6_GROUPS : zeros < 1) return null;
  const groups = [...left, ...Array<string>(zeros).fill('0'), ...right];
  if (!groups.every((group) => HEXTET_RE.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ''));
}

/**
 * The /64 an IPv6 address sits in: its first four hextets, canonicalised.
 *
 * Canonical form is the whole point — keying on the text as sent let
 * `2001:db8::1` and `2001:db8::2` take separate buckets (they are one subscriber)
 * while `2001:0db8:...` and `2001:db8:...` took separate buckets for one address.
 * Anything unexpandable is keyed whole: a bucket of its own is the safe guess.
 */
function ipv6Prefix(address: string): string {
  const groups = expandIpv6(address);
  if (!groups) return address.toLowerCase();
  return groups.slice(0, 4).join(':');
}

/**
 * The pre-auth bucket key. Cloudflare's cf-connecting-ip is the real caller and
 * cannot be spoofed at the edge. Without it we fall back to a hash of the raw
 * Authorization header (hashed so no token material is ever used as a key), and
 * finally to a shared 'anon' bucket — deliberately shared, because an
 * unidentifiable caller getting a private budget is the hole we are closing.
 *
 * An IPv6 caller is bucketed by its /64, not its address: the smallest block
 * routinely handed to a single subscriber is a /64, so keying on the full
 * address gives one holder 2^64 fresh budgets. IPv4 has no such spare room and
 * is keyed whole.
 */
function preAuthBucket(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip');
  if (ip) return ip.includes(':') ? ipv6Prefix(ip) : ip;
  const authorization = req.headers.get('authorization');
  if (authorization) {
    return createHash('sha256').update(authorization).digest('hex').slice(0, 16);
  }
  return 'anon';
}

// Both are `async` so a missing-binding throw surfaces as a REJECTED promise
// rather than a synchronous throw at the call site, which is what every caller
// (and every test) awaits.

/** Per-KEY bucket: each API key gets its own budget once it has been resolved. */
export const cloudflareRateLimiter: RateLimiter = async (keyId) =>
  consume(binding('API_RATE_LIMITER'), keyId);

/** Per-CALLER bucket, charged BEFORE key resolution touches the database. */
export const cloudflarePreAuthRateLimiter: PreAuthRateLimiter = async (req) =>
  consume(binding('API_PREAUTH_RATE_LIMITER'), preAuthBucket(req));
