import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePortalRateLimitEnv } from '@/test/fake-rate-limit-env';

// Round D: the client portal's per-link brake on the Cloudflare Rate Limiting
// bindings. The runtime probes are replaced so the on-platform path runs in Node.
vi.mock('server-only', () => ({}));
const isCloudflareRuntime = vi.fn(() => true);
const cfEnv = vi.fn(() => ({}) as Record<string, unknown>);
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime, cfEnv }));

const { portalActAllowed, portalReadAllowed } = await import('./portal-rate-limit');

const TOKEN = 'portal-link-token-AAAA';
const OTHER_TOKEN = 'portal-link-token-BBBB';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function calls(times: number, check: (token: unknown) => Promise<boolean>, token: unknown) {
  const verdicts: boolean[] = [];
  for (let index = 0; index < times; index += 1) verdicts.push(await check(token));
  return verdicts;
}

beforeEach(() => {
  isCloudflareRuntime.mockReturnValue(true);
  cfEnv.mockReturnValue(fakePortalRateLimitEnv());
});
afterEach(() => vi.restoreAllMocks());

describe('the per-link ceilings (W4)', () => {
  it('allows 30 acts a minute per link; the 31st is refused, another link is not', async () => {
    const verdicts = await calls(31, portalActAllowed, TOKEN);
    expect(verdicts.slice(0, 30).every(Boolean)).toBe(true);
    expect(verdicts[30]).toBe(false);
    expect(await portalActAllowed(OTHER_TOKEN)).toBe(true);
  });

  it('allows 300 reads a minute per link; the 301st is refused, and reads do not spend acts', async () => {
    const verdicts = await calls(301, portalReadAllowed, TOKEN);
    expect(verdicts.slice(0, 300).every(Boolean)).toBe(true);
    expect(verdicts[300]).toBe(false);
    expect(await portalActAllowed(TOKEN)).toBe(true);
  });

  it('counts a token with a stray space as the same link', async () => {
    await calls(30, portalActAllowed, TOKEN);
    expect(await portalActAllowed(` ${TOKEN}\n`)).toBe(false);
  });

  it('does not count a blank or non-string token', async () => {
    const env = fakePortalRateLimitEnv();
    cfEnv.mockReturnValue(env);
    for (const token of ['', '   ', undefined, null, 42, {}]) {
      expect(await portalActAllowed(token)).toBe(true);
      expect(await portalReadAllowed(token)).toBe(true);
    }
    expect(env.PORTAL_ACT_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(env.PORTAL_READ_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
});

describe('the key (W6)', () => {
  it('is the first 32 hex of the token sha256, never the raw token', async () => {
    const env = fakePortalRateLimitEnv();
    cfEnv.mockReturnValue(env);
    await portalActAllowed(TOKEN);
    await portalReadAllowed(TOKEN);
    const keys = [env.PORTAL_ACT_RATE_LIMITER, env.PORTAL_READ_RATE_LIMITER].map(
      (binding) => binding.limit.mock.calls[0][0].key,
    );
    expect(keys).toEqual([sha256(TOKEN).slice(0, 32), sha256(TOKEN).slice(0, 32)]);
    for (const key of keys) expect(key).not.toContain(TOKEN);
  });
});

describe('failure modes (W5)', () => {
  it('off-platform, everything is allowed and no binding is read', async () => {
    isCloudflareRuntime.mockReturnValue(false);
    expect(await calls(40, portalActAllowed, TOKEN)).not.toContain(false);
    expect(await portalReadAllowed(TOKEN)).toBe(true);
    expect(cfEnv).not.toHaveBeenCalled();
  });

  it('on Cloudflare with a binding missing, rejects with an error naming it', async () => {
    cfEnv.mockReturnValue({});
    await expect(portalActAllowed(TOKEN)).rejects.toThrow(/PORTAL_ACT_RATE_LIMITER/);
    await expect(portalReadAllowed(TOKEN)).rejects.toThrow(/PORTAL_READ_RATE_LIMITER/);
  });

  it('when limit() throws, allows and logs exactly once, with no token, hash or key', async () => {
    const key = sha256(TOKEN).slice(0, 32);
    const limit = vi.fn(async () => {
      throw new Error(`limiter unavailable for ${key}`);
    });
    cfEnv.mockReturnValue({ PORTAL_ACT_RATE_LIMITER: { limit } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await portalActAllowed(TOKEN)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls[0]);
    expect(logged).toContain('failing open');
    for (const secret of [TOKEN, sha256(TOKEN), key]) expect(logged).not.toContain(secret);
  });
});
