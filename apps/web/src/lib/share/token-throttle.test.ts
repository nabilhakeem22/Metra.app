import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { createTokenThrottle } = await import('./token-throttle');

// S2: the per-link brake on the portal's public acts and renditions.

describe('createTokenThrottle', () => {
  it('allows `limit` per window per link, then refuses until the window passes', () => {
    const throttle = createTokenThrottle(3, 60_000);
    const at = 1_000_000;
    expect([1, 2, 3, 4].map(() => throttle.allow('link-a', at))).toEqual([true, true, true, false]);
    expect(throttle.allow('link-b', at)).toBe(true);
    expect(throttle.allow('link-a', at + 59_999)).toBe(false);
    expect(throttle.allow('link-a', at + 60_000)).toBe(true);
  });

  it('does not count a blank or non-string token, and stays bounded', () => {
    const throttle = createTokenThrottle(1, 60_000, 2);
    for (let index = 0; index < 5; index += 1) expect(throttle.allow('   ')).toBe(true);
    expect(throttle.allow(5)).toBe(true);
    throttle.allow('one', 0);
    throttle.allow('two', 0);
    throttle.allow('three', 0);
    // 'one' was dropped to keep two windows, so it starts afresh.
    expect(throttle.allow('one', 0)).toBe(true);
  });
});
