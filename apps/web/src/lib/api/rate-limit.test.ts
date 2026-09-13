import { beforeEach, describe, expect, it, vi } from 'vitest';

// The limiters are server-only and read the Cloudflare env. Stub server-only and
// replace the runtime probes so we can drive the on-platform / off-platform and
// binding-present / binding-absent matrix from a plain Node test.
vi.mock('server-only', () => ({}));
const isCloudflareRuntime = vi.fn(() => true);
const cfEnv = vi.fn(() => ({}) as Record<string, unknown>);
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime, cfEnv }));

const { cloudflarePreAuthRateLimiter, cloudflareRateLimiter } = await import(
  './rate-limit'
);

const request = (headers: Record<string, string> = {}) =>
  new Request('https://api.metra.app/v1/clients', { headers });

function bindings(success: boolean) {
  const limit = vi.fn(async (_options: { key: string }) => ({ success }));
  return {
    limit,
    env: {
      API_RATE_LIMITER: { limit },
      API_PREAUTH_RATE_LIMITER: { limit },
    },
  };
}

beforeEach(() => {
  isCloudflareRuntime.mockReturnValue(true);
  cfEnv.mockReturnValue({});
});

describe('a missing binding on the Cloudflare runtime', () => {
  it('throws and NAMES the missing pre-auth binding rather than serving unlimited', async () => {
    await expect(cloudflarePreAuthRateLimiter(request())).rejects.toThrow(
      /API_PREAUTH_RATE_LIMITER/,
    );
  });

  it('throws and names the missing per-key binding', async () => {
    await expect(cloudflareRateLimiter('key-1')).rejects.toThrow(
      /API_RATE_LIMITER/,
    );
  });

  it('ALLOWS off-platform, where the binding is legitimately absent', async () => {
    isCloudflareRuntime.mockReturnValue(false);
    expect(await cloudflarePreAuthRateLimiter(request())).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(await cloudflareRateLimiter('key-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});

describe('bucket selection', () => {
  it('charges the caller IP when Cloudflare supplies one', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    await cloudflarePreAuthRateLimiter(request({ 'cf-connecting-ip': '1.2.3.4' }));
    expect(limit).toHaveBeenCalledWith({ key: '1.2.3.4' });
  });

  it('falls back to a hash of the Authorization header, never the token itself', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    await cloudflarePreAuthRateLimiter(request({ authorization: 'Bearer mtk_abc' }));
    const key = limit.mock.calls[0][0].key;
    expect(key).toHaveLength(16);
    expect(key).not.toContain('mtk_');
  });

  it('shares one anon bucket when the caller is unidentifiable', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    await cloudflarePreAuthRateLimiter(request());
    expect(limit).toHaveBeenCalledWith({ key: 'anon' });
  });

  // A /64 is the smallest block a subscriber is routinely given, so two
  // addresses inside one must land in the SAME bucket or the cap is free to
  // anyone with IPv6.
  it('buckets an IPv6 caller by its /64, not its address', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    await cloudflarePreAuthRateLimiter(
      request({ 'cf-connecting-ip': '2001:0db8:1234:5678:aaaa:bbbb:cccc:dddd' }),
    );
    await cloudflarePreAuthRateLimiter(
      request({ 'cf-connecting-ip': '2001:0DB8:1234:5678:1111:2222:3333:4444' }),
    );
    expect(limit.mock.calls.map((call) => call[0].key)).toEqual([
      '2001:db8:1234:5678',
      '2001:db8:1234:5678',
    ]);
  });

  // RFC 5952: `::` elides all-zero groups, so the same /64 has many spellings.
  // Keying on the text as sent gave one subscriber a fresh budget per spelling.
  it('expands a compressed address, so one /64 is one bucket however it is written', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    for (const ip of [
      '2001:db8::1',
      '2001:db8::2',
      '2001:0db8:0000:0000:0000:0000:0000:0003',
      '2001:DB8::ffff:4',
    ]) {
      await cloudflarePreAuthRateLimiter(request({ 'cf-connecting-ip': ip }));
    }
    expect(limit.mock.calls.map((call) => call[0].key)).toEqual([
      '2001:db8:0:0',
      '2001:db8:0:0',
      '2001:db8:0:0',
      '2001:db8:0:0',
    ]);
  });

  it('keeps distinct /64s in distinct buckets', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    await cloudflarePreAuthRateLimiter(request({ 'cf-connecting-ip': '2001:db8::1' }));
    await cloudflarePreAuthRateLimiter(
      request({ 'cf-connecting-ip': '2001:db8:0:1::1' }),
    );
    expect(limit.mock.calls.map((call) => call[0].key)).toEqual([
      '2001:db8:0:0',
      '2001:db8:0:1',
    ]);
  });

  it('keys an address it cannot expand whole rather than guessing a prefix', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    // An IPv4-mapped address carries a dotted quad, which is not a hextet; a
    // loopback expands normally and must still reduce to its own /64.
    await cloudflarePreAuthRateLimiter(
      request({ 'cf-connecting-ip': '::FFFF:1.2.3.4' }),
    );
    await cloudflarePreAuthRateLimiter(request({ 'cf-connecting-ip': '::1' }));
    expect(limit.mock.calls.map((call) => call[0].key)).toEqual([
      '::ffff:1.2.3.4',
      '0:0:0:0',
    ]);
  });

  it('charges the resolved key id on the per-key bucket', async () => {
    const { limit, env } = bindings(true);
    cfEnv.mockReturnValue(env);
    await cloudflareRateLimiter('key-1');
    expect(limit).toHaveBeenCalledWith({ key: 'key-1' });
  });
});

describe('the limiter verdict', () => {
  it('denies with a retry-after window when the bucket is exhausted', async () => {
    cfEnv.mockReturnValue(bindings(false).env);
    expect(await cloudflarePreAuthRateLimiter(request())).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('fails OPEN when the binding itself errors, so a blip is not an outage', async () => {
    const limit = vi.fn(async () => {
      throw new Error('limiter unavailable');
    });
    cfEnv.mockReturnValue({
      API_RATE_LIMITER: { limit },
      API_PREAUTH_RATE_LIMITER: { limit },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await cloudflareRateLimiter('key-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
