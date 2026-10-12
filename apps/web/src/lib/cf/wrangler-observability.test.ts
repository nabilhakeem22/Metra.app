import { describe, expect, it } from 'vitest';
import { wranglerConfig } from '@/test/wrangler-rate-limits';

// Round E S2: Workers traces stay OFF for metra-web. A fetch span records the
// full URL, and a signed Storage URL carries its token in the query. The
// top-level switch stays what every deploy already sent (`enabled: false`,
// wrangler's value for a missing key); logs and invocation logs are not named.

describe('the Worker observability settings', () => {
  const observability = wranglerConfig().observability as { traces?: { enabled?: unknown }; logs?: unknown; enabled?: unknown };

  it('turns traces off explicitly', () => {
    expect(observability.traces).toEqual({ enabled: false });
  });

  it('keeps the top-level switch as deploys already set it, and names no log setting', () => {
    expect(observability.enabled).toBe(false);
    expect(observability.logs).toBeUndefined();
  });
});
