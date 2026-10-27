import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countingRateLimit, type FakeRateLimit } from '@/test/fake-rate-limit-env';
import { AUTH_OTP_IDENTIFIER_CEILING, AUTH_OTP_IP_CEILING } from '@/test/wrangler-rate-limits';

// S2 (go-live security): the sign-in throttle's keys, order and failure modes.
// The identifier arrives canonical (otp-identifier.ts, applied by otp-route.ts).
// The Cloudflare runtime and its two bindings are fakes at the wrangler.jsonc
// ceilings; the real throttle, caller bucket and binding wrapper run.

vi.mock('server-only', () => ({}));
const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => true, cfEnv: () => runtime.env }));

const { otpThrottleRefusal } = await import('./otp-throttle');

const EMAIL = 'mona@firm.example';
let ipBinding: FakeRateLimit;
let identifierBinding: FakeRateLimit;

const fromIp = (ip: string) => new Request('https://metra.app/api/auth/otp/send', { headers: { 'cf-connecting-ip': ip } });
const keysOf = (binding: FakeRateLimit) => binding.limit.mock.calls.map(([options]) => options.key);

beforeEach(() => {
  ipBinding = countingRateLimit(AUTH_OTP_IP_CEILING);
  identifierBinding = countingRateLimit(AUTH_OTP_IDENTIFIER_CEILING);
  runtime.env = { AUTH_OTP_IP_RATE_LIMITER: ipBinding, AUTH_OTP_IDENTIFIER_RATE_LIMITER: identifierBinding };
});

describe('otpThrottleRefusal keys', () => {
  it('keys the IP bucket by step and caller IP, the identifier bucket by step and a hash', async () => {
    expect(await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', EMAIL)).toBeNull();
    expect(keysOf(ipBinding)).toEqual(['send:203.0.113.9']);
    expect(keysOf(identifierBinding)[0]).toMatch(/^send:[0-9a-f]{32}$/);
  });

  it('keys the identifier exactly as given (the route made it canonical), and never uses it as a key', async () => {
    for (const identifier of [EMAIL, EMAIL, '+201001234567']) {
      await otpThrottleRefusal(fromIp('203.0.113.9'), 'verify', identifier);
    }
    expect(new Set(keysOf(identifierBinding)).size).toBe(2);
    const keys = JSON.stringify([keysOf(ipBinding), keysOf(identifierBinding)]);
    expect(keys).not.toContain('mona');
    expect(keys).not.toContain('1001234567');
  });

  it('puts two IPv6 callers in one /64 in one IP bucket', async () => {
    await otpThrottleRefusal(fromIp('2001:db8:1:2::1'), 'send', 'a@b.example');
    await otpThrottleRefusal(fromIp('2001:db8:1:2:ffff::9'), 'send', 'c@d.example');
    expect(keysOf(ipBinding)).toEqual(['send:2001:db8:1:2', 'send:2001:db8:1:2']);
  });

  it('keeps send and verify apart, in the IP bucket and in the identifier bucket', async () => {
    await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', EMAIL);
    await otpThrottleRefusal(fromIp('203.0.113.9'), 'verify', EMAIL);
    expect(keysOf(ipBinding)).toEqual(['send:203.0.113.9', 'verify:203.0.113.9']);
    const [sendKey, verifyKey] = keysOf(identifierBinding);
    expect(sendKey.replace('send:', 'verify:')).toBe(verifyKey);
  });
});

describe('otpThrottleRefusal order and failures', () => {
  it('a request the IP bucket refuses never charges the identifier bucket', async () => {
    ipBinding.limit.mockResolvedValue({ success: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refused = await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', EMAIL);
    expect(refused).toEqual({ status: 429, body: { ok: false, error: 'otp_rate_limited' } });
    expect(identifierBinding.limit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('otp rate limit refused:', { binding: 'AUTH_OTP_IP_RATE_LIMITER', step: 'send' });
    warn.mockRestore();
  });

  it('refuses with a logged generic when a binding is missing on Cloudflare', async () => {
    runtime.env = { AUTH_OTP_IDENTIFIER_RATE_LIMITER: identifierBinding };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = await otpThrottleRefusal(fromIp('203.0.113.9'), 'verify', EMAIL);
    expect(refused?.status).toBe(500);
    expect(refused?.body).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(JSON.stringify(error.mock.calls)).toContain('AUTH_OTP_IP_RATE_LIMITER');
    expect(JSON.stringify(error.mock.calls).toLowerCase()).not.toContain('mona');
    error.mockRestore();
  });

  it('lets the request through when a binding errors, logged by binding name', async () => {
    identifierBinding.limit.mockRejectedValue(new Error(`limiter unavailable for ${EMAIL}`));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', EMAIL)).toBeNull();
    expect(JSON.stringify(error.mock.calls)).toContain('AUTH_OTP_IDENTIFIER_RATE_LIMITER');
    error.mockRestore();
  });
});
