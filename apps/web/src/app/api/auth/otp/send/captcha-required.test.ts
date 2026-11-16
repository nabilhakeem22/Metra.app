import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as doubles from '@/test/otp-route-doubles';
import { otpPost } from '@/test/otp-route-doubles';

// POST /api/auth/otp/send in a build WITH the Turnstile site key (P3). The
// login page of that build sends a token with every send, so a request with
// none did not come from the page: 400 malformed, and Supabase is never asked
// (whether Supabase's own CAPTCHA setting is on or off). The build with no
// site key is ./captcha-token.test.ts (AC3: a send without a token goes
// through). The real route, core and failure mapping run; Supabase is a double.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', async () => ({ cookies: async () => (await import('@/test/otp-route-doubles')).cookieStore }));
vi.mock('@supabase/ssr', async () => ({ createServerClient: (await import('@/test/otp-route-doubles')).createServerClient }));
vi.mock('@/lib/db/context', async () => ({ withUserContext: (await import('@/test/otp-route-doubles')).withUserContext }));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');
// Cloudflare's published always-pass test site key: the build shows the widget.
vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');

const { POST } = await import('./route');

const EMAIL = { channel: 'email', identifier: 'mona@firm.example' };
const PHONE = { channel: 'phone', identifier: '+201001234567' };
const TOKEN = 'tok-0123456789-secretish';

async function send(body: Record<string, unknown>) {
  const response = await POST(otpPost('/api/auth/otp/send', JSON.stringify(body)));
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  doubles.resetOtpRouteDoubles();
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe('POST /api/auth/otp/send in a build that shows the challenge (P3)', () => {
  it.each([
    ['an email send with no token', EMAIL],
    ['a phone send with no token', PHONE],
    ['an empty token', { ...EMAIL, captchaToken: '' }],
    ['a token of spaces', { ...EMAIL, captchaToken: '   ' }],
    ['a null token', { ...EMAIL, captchaToken: null }],
  ])('answers %s 400 malformed, and Supabase is never asked', async (_case, body) => {
    expect(await send(body)).toEqual({ status: 400, body: { ok: false, error: 'malformed' } });
    expect(doubles.createServerClient).not.toHaveBeenCalled();
    expect(doubles.supabaseAuth.signInWithOtp).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it('a send with a token goes to Supabase with it, exactly as before', async () => {
    expect(await send({ ...EMAIL, captchaToken: TOKEN })).toEqual({ status: 200, body: { ok: true } });
    expect(doubles.supabaseAuth.signInWithOtp.mock.calls[0]![0]).toStrictEqual({
      email: 'mona@firm.example',
      options: { shouldCreateUser: true, captchaToken: TOKEN },
    });
    await send({ ...PHONE, captchaToken: TOKEN });
    expect(doubles.supabaseAuth.signInWithOtp.mock.calls[1]![0]).toStrictEqual({ phone: '+201001234567', options: { captchaToken: TOKEN } });
  });
});
