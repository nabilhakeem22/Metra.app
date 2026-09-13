import 'server-only';
import { createHash } from 'node:crypto';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';

// Cloudflare Workers Rate Limiting bindings for the Public API (v1). Two buckets:
//   API_RATE_LIMITER          100 requests / 60s per resolved KEY (post-auth).
//   API_PREAUTH_RATE_LIMITER  300 requests / 60s per CALLER (pre-auth).
// The pre-auth bucket exists because key resolution costs a database round trip:
// without it an unauthenticated flood of garbage bearer tokens is a free way to
// hammer the database, and the per-key limiter can never see it because there is
// no key. Off-platform (Node/Vitest, `next dev` on Node) the bindings are absent,
// so this degrades to ALLOW — tests and local dev are never rate-limited.

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
 * Runs one bucket. A binding ERROR fails OPEN: an availability blip in the
 * limiter must not take the whole API down. A MISSING binding does not reach
 * here — `binding()` throws, and that throw is a 500, which is correct for a
 * misdeployed Worker.
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
    console.error('rate limiter error (failing open):', error);
    return ALLOW;
  }
}

/**
 * The /64 an IPv6 address sits in: its first four hextets, lower-cased. A
 * compressed address (`2001:db8::1`) yields fewer than four groups and is used
 * as given — it already names its own prefix.
 */
function ipv6Prefix(address: string): string {
  return address.toLowerCase().split(':').slice(0, 4).join(':');
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
