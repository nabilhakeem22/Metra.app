import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countingRateLimit, type FakeRateLimit } from '@/test/fake-rate-limit-env';
import { AUTH_OTP_IDENTIFIER_CEILING, AUTH_OTP_IP_CEILING } from '@/test/wrangler-rate-limits';

// S2 (go-live security): the sign-in throttle's keys, order and failure modes.
// The Cloudflare runtime and its two bindings are fakes at the wrangler.jsonc
// ceilings; the real throttle, caller bucket and binding wrapper run.

vi.mock('server-only', () => ({}));
const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => true, cfEnv: () => runtime.env }));

const { otpThrottleRefusal } = await import('./otp-throttle');

const EMAIL = 'Mona@Firm.example';
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
    expect(await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', { channel: 'email', identifier: EMAIL })).toBeNull();
    expect(keysOf(ipBinding)).toEqual(['send:203.0.113.9']);
    expect(keysOf(identifierBinding)[0]).toMatch(/^send:[0-9a-f]{32}$/);
  });

  it('gives every spelling of one address one identifier bucket, and never uses the address as a key', async () => {
    for (const identifier of [EMAIL, ' mona@firm.example ', 'MONA@FIRM.EXAMPLE']) {
      await otpThrottleRefusal(fromIp('203.0.113.9'), 'verify', { channel: 'email', identifier });
    }
    expect(new Set(keysOf(identifierBinding)).size).toBe(1);
    expect(JSON.stringify([keysOf(ipBinding), keysOf(identifierBinding)]).toLowerCase()).not.toContain('mona');
  });

  it('keys a phone by its trimmed digits, hashed', async () => {
    await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', { channel: 'phone', identifier: ' +201001234567 ' });
    await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', { channel: 'phone', identifier: '+201001234567' });
    expect(new Set(keysOf(identifierBinding)).size).toBe(1);
    expect(JSON.stringify(keysOf(identifierBinding))).not.toContain('1001234567');
  });

  it('puts two IPv6 callers in one /64 in one IP bucket', async () => {
    await otpThrottleRefusal(fromIp('2001:db8:1:2::1'), 'send', { channel: 'email', identifier: 'a@b.example' });
    await otpThrottleRefusal(fromIp('2001:db8:1:2:ffff::9'), 'send', { channel: 'email', identifier: 'c@d.example' });
    expect(keysOf(ipBinding)).toEqual(['send:2001:db8:1:2', 'send:2001:db8:1:2']);
  });

  it('keeps send and verify apart', async () => {
    await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', { channel: 'email', identifier: EMAIL });
    await otpThrottleRefusal(fromIp('203.0.113.9'), 'verify', { channel: 'email', identifier: EMAIL });
    expect(keysOf(ipBinding)).toEqual(['send:203.0.113.9', 'verify:203.0.113.9']);
  });
});

describe('otpThrottleRefusal order and failures', () => {
  it('a request the IP bucket refuses never charges the identifier bucket', async () => {
    ipBinding.limit.mockResolvedValue({ success: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refused = await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', { channel: 'email', identifier: EMAIL });
    expect(refused).toEqual({ status: 429, body: { ok: false, error: 'otp_rate_limited' } });
    expect(identifierBinding.limit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('otp rate limit refused:', { binding: 'AUTH_OTP_IP_RATE_LIMITER', step: 'send' });
    warn.mockRestore();
  });

  it('refuses with a logged generic when a binding is missing on Cloudflare', async () => {
    runtime.env = { AUTH_OTP_IDENTIFIER_RATE_LIMITER: identifierBinding };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = await otpThrottleRefusal(fromIp('203.0.113.9'), 'verify', { channel: 'email', identifier: EMAIL });
    expect(refused?.status).toBe(500);
    expect(refused?.body).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(JSON.stringify(error.mock.calls)).toContain('AUTH_OTP_IP_RATE_LIMITER');
    expect(JSON.stringify(error.mock.calls).toLowerCase()).not.toContain('mona');
    error.mockRestore();
  });

  it('lets the request through when a binding errors, logged by binding name', async () => {
    identifierBinding.limit.mockRejectedValue(new Error(`limiter unavailable for ${EMAIL}`));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await otpThrottleRefusal(fromIp('203.0.113.9'), 'send', { channel: 'email', identifier: EMAIL })).toBeNull();
    expect(JSON.stringify(error.mock.calls)).toContain('AUTH_OTP_IDENTIFIER_RATE_LIMITER');
    error.mockRestore();
  });
});
