import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as doubles from '@/test/otp-route-doubles';
import { otpPost } from '@/test/otp-route-doubles';
import { countingRateLimit } from '@/test/fake-rate-limit-env';
import { AUTH_OTP_IDENTIFIER_CEILING, AUTH_OTP_IP_CEILING } from '@/test/wrangler-rate-limits';

// S2 (go-live security): both sign-in code routes charge the throttle BEFORE
// any Supabase call. The real routes, throttle and binding wrapper run on a
// fake Cloudflare runtime whose two bindings count at the wrangler.jsonc
// ceilings; Supabase is a double.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', async () => ({ cookies: async () => (await import('@/test/otp-route-doubles')).cookieStore }));
vi.mock('@supabase/ssr', async () => ({ createServerClient: (await import('@/test/otp-route-doubles')).createServerClient }));
vi.mock('@/lib/db/context', async () => ({ withUserContext: (await import('@/test/otp-route-doubles')).withUserContext }));
const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => true, cfEnv: () => runtime.env }));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { POST: send } = await import('./send/route');
const { POST: verify } = await import('./verify/route');

const sendBody = (identifier: string) => JSON.stringify({ channel: 'email', identifier });
const verifyBody = (identifier: string) => JSON.stringify({ channel: 'email', identifier, token: '123456' });

let consoleCalls: unknown[][];
beforeEach(() => {
  doubles.resetOtpRouteDoubles();
  runtime.env = {
    AUTH_OTP_IP_RATE_LIMITER: countingRateLimit(AUTH_OTP_IP_CEILING),
    AUTH_OTP_IDENTIFIER_RATE_LIMITER: countingRateLimit(AUTH_OTP_IDENTIFIER_CEILING),
  };
  consoleCalls = [];
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void consoleCalls.push(args));
  }
});
afterEach(() => vi.restoreAllMocks());

describe('the sign-in throttle on the routes', () => {
  it('answers the 11th send from one IP within the window with 429 and never calls Supabase for it', async () => {
    for (let index = 1; index <= AUTH_OTP_IP_CEILING; index += 1) {
      const response = await send(otpPost('/api/auth/otp/send', sendBody(`person${index}@firm.example`), { 'cf-connecting-ip': '203.0.113.9' }));
      expect(response.status).toBe(200);
    }
    const refused = await send(otpPost('/api/auth/otp/send', sendBody('late@firm.example'), { 'cf-connecting-ip': '203.0.113.9' }));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ ok: false, error: 'otp_rate_limited' });
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(refused.headers.get('cache-control')).toBe('no-store');
    expect(doubles.supabaseAuth.signInWithOtp).toHaveBeenCalledTimes(AUTH_OTP_IP_CEILING);
  });

  it('answers the 6th verify for one address, however typed and from any IP, with 429', async () => {
    const spellings = ['mona@firm.example', 'MONA@firm.example', ' mona@FIRM.example ', 'Mona@Firm.Example', 'mona@firm.example '];
    for (const [index, identifier] of spellings.entries()) {
      const response = await verify(otpPost('/api/auth/otp/verify', verifyBody(identifier), { 'cf-connecting-ip': `198.51.100.${index}` }));
      expect(response.status).toBe(200);
    }
    const refused = await verify(otpPost('/api/auth/otp/verify', verifyBody('MONA@FIRM.EXAMPLE'), { 'cf-connecting-ip': '192.0.2.77' }));
    expect(refused.status).toBe(429);
    expect(doubles.supabaseAuth.verifyOtp).toHaveBeenCalledTimes(AUTH_OTP_IDENTIFIER_CEILING);
  });

  it.each([
    ['send', () => send(otpPost('/api/auth/otp/send', sendBody('mona@firm.example'), { 'cf-connecting-ip': '203.0.113.9' }))],
    ['verify', () => verify(otpPost('/api/auth/otp/verify', verifyBody('mona@firm.example'), { 'cf-connecting-ip': '203.0.113.9' }))],
  ])('%s answers 500 generic, without Supabase, when the IP binding is missing on Cloudflare', async (_step, call) => {
    delete runtime.env.AUTH_OTP_IP_RATE_LIMITER;
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{8}$/) });
    expect(doubles.supabaseAuth.signInWithOtp).not.toHaveBeenCalled();
    expect(doubles.supabaseAuth.verifyOtp).not.toHaveBeenCalled();
  });

  it('never logs the raw address or phone, nor uses one as a bucket key', async () => {
    for (let index = 0; index <= AUTH_OTP_IDENTIFIER_CEILING; index += 1) {
      await send(otpPost('/api/auth/otp/send', sendBody('secret.person@firm.example'), { 'cf-connecting-ip': '203.0.113.9' }));
      await send(otpPost('/api/auth/otp/send', JSON.stringify({ channel: 'phone', identifier: '+201001234567' }), { 'cf-connecting-ip': '203.0.113.10' }));
    }
    const keys = Object.values(runtime.env).flatMap((binding) => (binding as ReturnType<typeof countingRateLimit>).limit.mock.calls);
    const seen = JSON.stringify([consoleCalls, keys]);
    expect(consoleCalls.length).toBeGreaterThan(0);
    expect(seen).not.toContain('secret.person');
    expect(seen).not.toContain('1001234567');
  });
});
