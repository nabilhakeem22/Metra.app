import { describe, expect, it } from 'vitest';
import { wranglerConfig } from '@/test/wrangler-rate-limits';

// Round E S2: Workers traces stay OFF for metra-web. A fetch span records the
// full URL, and a signed Storage URL carries its token in the query. Only the
// traces switch is pinned: logs and invocation logs (what `wrangler tail` and
// the Workers Logs view read) are not touched by this config.

describe('the Worker observability settings', () => {
  const observability = wranglerConfig().observability as { traces?: { enabled?: unknown }; logs?: unknown; enabled?: unknown };

  it('turns traces off explicitly', () => {
    expect(observability.traces).toEqual({ enabled: false });
  });

  it('leaves logs and the top-level switch to their current settings', () => {
    expect(observability.logs).toBeUndefined();
    expect(observability.enabled).toBeUndefined();
  });
});
