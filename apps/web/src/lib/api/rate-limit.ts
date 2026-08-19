import 'server-only';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';

// Cloudflare Workers Rate Limiting binding wrapper for the Public API (v1).
// Default policy (configured in wrangler.jsonc): 100 requests / 60s per KEY.
// Off-platform (Node/Vitest, `next dev` on Node) the binding is absent, so this
// degrades to ALLOW — tests and local dev are never rate-limited.

export const RATE_LIMIT_MAX = 100;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (for the Retry-After header). */
  retryAfterSeconds: number;
}

export type RateLimiter = (keyId: string) => Promise<RateLimitResult>;

const ALLOW: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

/** The Cloudflare Rate Limiting binding shape (subset used here). */
interface CloudflareRateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function binding(): CloudflareRateLimit | null {
  if (!isCloudflareRuntime()) return null;
  const env = cfEnv() as unknown as {
    API_RATE_LIMITER?: CloudflareRateLimit;
  };
  return env.API_RATE_LIMITER ?? null;
}

/**
 * The default limiter: keyed by the resolved key id so each API key gets its own
 * budget. ALLOW when the binding is absent (off-platform). Fails OPEN on a binding
 * error — an availability blip in the limiter must not take the whole API down.
 */
export const cloudflareRateLimiter: RateLimiter = async (keyId) => {
  const limiter = binding();
  if (!limiter) return ALLOW;
  try {
    const { success } = await limiter.limit({ key: keyId });
    return success
      ? ALLOW
      : { allowed: false, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS };
  } catch (error) {
    console.error('rate limiter error (failing open):', error);
    return ALLOW;
  }
};
