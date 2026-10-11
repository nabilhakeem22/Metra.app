import { vi, type Mock } from 'vitest';
import { PORTAL_ACT_CEILING, PORTAL_READ_CEILING } from './wrangler-rate-limits';

// TEST-ONLY. Stand-ins for Cloudflare Workers Rate Limiting bindings, so a Node
// test can drive the on-platform path. A binding here counts every call per key
// and refuses past its ceiling, which is what the real binding does within one
// data centre and one period. Node cannot prove the real binding's behaviour on
// workerd; the local `wrangler dev` run in the PR does that.

export interface FakeRateLimit {
  limit: Mock<(options: { key: string }) => Promise<{ success: boolean }>>;
}

/** A binding that allows `ceiling` calls per key, then refuses that key. */
export function countingRateLimit(ceiling: number): FakeRateLimit {
  const counts = new Map<string, number>();
  return {
    limit: vi.fn(async ({ key }: { key: string }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= ceiling };
    }),
  };
}

/** The Worker env with the two portal bindings at their wrangler.jsonc ceilings. */
export function fakePortalRateLimitEnv(): {
  PORTAL_ACT_RATE_LIMITER: FakeRateLimit;
  PORTAL_READ_RATE_LIMITER: FakeRateLimit;
} {
  return {
    PORTAL_ACT_RATE_LIMITER: countingRateLimit(PORTAL_ACT_CEILING),
    PORTAL_READ_RATE_LIMITER: countingRateLimit(PORTAL_READ_CEILING),
  };
}
