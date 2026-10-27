import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as doubles from '@/test/otp-route-doubles';
import { otpPost } from '@/test/otp-route-doubles';

// POST /api/auth/otp/send with the login page's Turnstile token (go-live T3).
// Supabase checks the token (its CAPTCHA setting); the route only checks its
// shape and passes it on. The real route, core and failure mapping run;
// Supabase is a double. The token must never reach a log line.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', async () => ({ cookies: async () => (await import('@/test/otp-route-doubles')).cookieStore }));
vi.mock('@supabase/ssr', async () => ({ createServerClient: (await import('@/test/otp-route-doubles')).createServerClient }));
vi.mock('@/lib/db/context', async () => ({ withUserContext: (await import('@/test/otp-route-doubles')).withUserContext }));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { POST } = await import('./route');

const EMAIL = JSON.stringify({ channel: 'email', identifier: 'mona@firm.example' });
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

async function send(body: string) {
  const response = await POST(otpPost('/api/auth/otp/send', body));
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  doubles.resetOtpRouteDoubles();
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe('POST /api/auth/otp/send: the Turnstile token (T3)', () => {
  const TOKEN = 'tok-0123456789-secretish';
  const withToken = (body: Record<string, unknown>) => JSON.stringify({ ...body, captchaToken: TOKEN });

  it('passes the token to Supabase with an email send (AC1)', async () => {
    expect(await send(withToken({ channel: 'email', identifier: 'mona@firm.example' }))).toEqual({ status: 200, body: { ok: true } });
    expect(doubles.supabaseAuth.signInWithOtp).toHaveBeenCalledOnce();
    expect(doubles.supabaseAuth.signInWithOtp.mock.calls[0]![0]).toStrictEqual({
      email: 'mona@firm.example',
      options: { shouldCreateUser: true, captchaToken: TOKEN },
    });
  });

  it('passes the token to Supabase with a phone send (AC2)', async () => {
    await send(withToken({ channel: 'phone', identifier: '+201001234567' }));
    expect(doubles.supabaseAuth.signInWithOtp.mock.calls[0]![0]).toStrictEqual({ phone: '+201001234567', options: { captchaToken: TOKEN } });
  });

  it('a send without a token passes none (AC3)', async () => {
    await send(EMAIL);
    expect(doubles.supabaseAuth.signInWithOtp.mock.calls[0]![0]).toStrictEqual({
      email: 'mona@firm.example',
      options: { shouldCreateUser: true, captchaToken: undefined },
    });
  });

  it.each([['a number', 123], ['null', null], ['an object', {}], ['an empty string', ''], ['2049 characters', 't'.repeat(2049)]])(
    'answers a token that is %s 400 malformed, without Supabase (AC4)',
    async (_case, captchaToken) => {
      const body = JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', captchaToken });
      expect(await send(body)).toEqual({ status: 400, body: { ok: false, error: 'malformed' } });
      expect(doubles.createServerClient).not.toHaveBeenCalled();
    },
  );

  it('accepts a 320-character identifier with a 2048-character token under the 4 KiB cap (AC9)', async () => {
    const body = JSON.stringify({ channel: 'email', identifier: `${'a'.repeat(307)}@firm.example`, captchaToken: 't'.repeat(2048) });
    expect((await send(body)).status).toBe(200);
    expect(doubles.supabaseAuth.signInWithOtp).toHaveBeenCalledOnce();
  });

  it('a refused token is otp_captcha_failed, logged by code and status, never the token (AC5)', async () => {
    doubles.supabaseAuth.signInWithOtp.mockResolvedValueOnce({ error: { code: 'captcha_failed', status: 400, message: `bad ${TOKEN}` } });
    expect(await send(withToken({ channel: 'email', identifier: 'mona@firm.example' }))).toEqual({
      status: 200,
      body: { ok: false, error: 'otp_captcha_failed' },
    });
    expect(logged).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith('sendEmailOtp failed', { code: 'captcha_failed', status: 400 });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(TOKEN);
  });

  it('a challenge check that fails upstream is the referenced generic: closed, not open (AC6)', async () => {
    doubles.supabaseAuth.signInWithOtp.mockResolvedValueOnce({ error: { code: 'unexpected_failure', status: 500, message: TOKEN } });
    const { status, body } = await send(withToken({ channel: 'email', identifier: 'mona@firm.example' }));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(TOKEN);
  });
});
