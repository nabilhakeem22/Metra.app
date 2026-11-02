import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as doubles from '@/test/otp-route-doubles';
import { otpPost } from '@/test/otp-route-doubles';

// POST /api/auth/otp/verify (AC5): the verifyEmailOtp / verifyPhoneOtp answers
// over a same-origin JSON route, plus where to go next. The real route, core,
// failure mapping and membership probe run; Supabase and the database are
// doubles.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', async () => ({ cookies: async () => (await import('@/test/otp-route-doubles')).cookieStore }));
vi.mock('@supabase/ssr', async () => ({ createServerClient: (await import('@/test/otp-route-doubles')).createServerClient }));
vi.mock('@/lib/db/context', async () => ({ withUserContext: (await import('@/test/otp-route-doubles')).withUserContext }));
// The site app ships in PR S4; a test switches its landing on to prove the rule (AC8).
const siteApp = vi.hoisted(() => ({ live: false }));
vi.mock('@/lib/site/app-live', () => ({
  get SITE_APP_LIVE() {
    return siteApp.live;
  },
}));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { POST, dynamic } = await import('./route');

const PATH = '/api/auth/otp/verify';
const EMAIL_CODE = JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: '123456' });
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

async function verify(body: string, headers?: Record<string, string | undefined>) {
  const response = await POST(otpPost(PATH, body, headers));
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  doubles.resetOtpRouteDoubles();
  siteApp.live = false;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe('POST /api/auth/otp/verify', () => {
  it('is always rendered on request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('a member lands on the dashboard, with the session cookies written hardened (S5)', async () => {
    expect(await verify(EMAIL_CODE)).toEqual({ status: 200, body: { ok: true, next: '/dashboard' } });
    expect(doubles.supabaseAuth.verifyOtp).toHaveBeenCalledWith({ email: 'mona@firm.example', token: '123456', type: 'email' });
    expect(doubles.withUserContext).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(doubles.writtenCookies).toEqual(doubles.WRITTEN_SESSION_COOKIES);
  });

  it('a captchaToken in the body never reaches Supabase: verify is not challenged (AC8)', async () => {
    const body = JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: '123456', captchaToken: 'tok' });
    expect((await verify(body)).body).toEqual({ ok: true, next: '/dashboard' });
    expect(doubles.supabaseAuth.verifyOtp.mock.calls[0]![0]).toStrictEqual({ email: 'mona@firm.example', token: '123456', type: 'email' });
  });

  it('a user without a workspace lands on onboarding', async () => {
    doubles.withUserContext.mockResolvedValueOnce([]);
    expect(await verify(EMAIL_CODE)).toEqual({ status: 200, body: { ok: true, next: '/onboarding' } });
  });

  it('a failed membership probe never blocks the sign-in: dashboard, and one log line', async () => {
    doubles.withUserContext.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect(await verify(EMAIL_CODE)).toEqual({ status: 200, body: { ok: true, next: '/dashboard' } });
    expect(logged).toHaveBeenCalledWith('resolvePostLoginPath failed:', expect.anything());
    expect(doubles.writtenCookies).toEqual(doubles.WRITTEN_SESSION_COOKIES);
  });

  it('a verify with no user in its answer goes to the dashboard and is logged', async () => {
    doubles.supabaseAuth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await verify(EMAIL_CODE)).toEqual({ status: 200, body: { ok: true, next: '/dashboard' } });
    expect(doubles.withUserContext).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith('verifyOtp returned no user');
  });

  describe('the site app landing (AC8)', () => {
    const FROM_SITE_APP = JSON.stringify({ channel: 'phone', identifier: '+201001234567', token: '654321', return: 'site' });

    it('is off until the site app ships: return=site and an engineer land as before', async () => {
      expect((await verify(FROM_SITE_APP)).body).toEqual({ ok: true, next: '/dashboard' });
      doubles.withUserContext.mockResolvedValueOnce([{ role: 'site_engineer' }]);
      expect((await verify(EMAIL_CODE)).body).toEqual({ ok: true, next: '/dashboard' });
    });

    it('with the app live, return=site answers /site', async () => {
      siteApp.live = true;
      expect(await verify(FROM_SITE_APP)).toEqual({ status: 200, body: { ok: true, next: '/site' } });
    });

    it('with the app live, a person who is only a site engineer gets /site without it, and an owner the dashboard', async () => {
      siteApp.live = true;
      doubles.withUserContext.mockResolvedValueOnce([{ role: 'site_engineer' }, { role: 'client' }]);
      expect((await verify(EMAIL_CODE)).body).toEqual({ ok: true, next: '/site' });
      doubles.withUserContext.mockResolvedValueOnce([{ role: 'site_engineer' }, { role: 'owner' }]);
      expect((await verify(EMAIL_CODE)).body).toEqual({ ok: true, next: '/dashboard' });
      expect((await verify(EMAIL_CODE)).body).toEqual({ ok: true, next: '/dashboard' });
    });

    it('with the app live, return=site with no internal membership takes the normal path (F5)', async () => {
      siteApp.live = true;
      doubles.withUserContext.mockResolvedValueOnce([]);
      expect((await verify(FROM_SITE_APP)).body).toEqual({ ok: true, next: '/onboarding' });
      doubles.withUserContext.mockResolvedValueOnce([{ role: 'client' }]);
      expect((await verify(FROM_SITE_APP)).body).toEqual({ ok: true, next: '/dashboard' });
    });

    it('with the app live, a failed probe takes the normal path even with return=site', async () => {
      siteApp.live = true;
      doubles.withUserContext.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      expect((await verify(FROM_SITE_APP)).body).toEqual({ ok: true, next: '/dashboard' });
    });
  });

  it('checks a phone code as an SMS code', async () => {
    const body = JSON.stringify({ channel: 'phone', identifier: '+201001234567', token: '654321' });
    expect((await verify(body)).body).toEqual({ ok: true, next: '/dashboard' });
    expect(doubles.supabaseAuth.verifyOtp).toHaveBeenCalledWith({ phone: '+201001234567', token: '654321', type: 'sms' });
  });

  it('a wrong or expired code is otp_verify_failed under the code box, with no next and no cookies', async () => {
    doubles.supabaseAuth.verifyOtp.mockResolvedValueOnce({ error: { code: 'otp_expired', status: 403 } });
    expect(await verify(EMAIL_CODE)).toEqual({
      status: 200,
      body: { ok: false, error: 'check_fields', fields: { token: { code: 'otp_verify_failed' } } },
    });
    expect(doubles.writtenCookies).toEqual([]);
  });

  it('a short code is refused under the code box before Supabase is asked', async () => {
    const body = JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: '123' });
    expect((await verify(body)).body).toEqual({ ok: false, error: 'check_fields', fields: { token: { code: 'too_short', params: { min: 6 } } } });
    expect(doubles.createServerClient).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, string | undefined>]>([
    ['no Origin', { origin: undefined }],
    ['a cross-host Origin', { origin: 'https://evil.example' }],
    ['a text/plain body', { 'content-type': 'text/plain' }],
  ])('refuses %s with 403 before calling Supabase', async (_case, headers) => {
    expect(await verify(EMAIL_CODE, headers)).toEqual({ status: 403, body: { ok: false, error: 'forbidden' } });
    expect(doubles.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not JSON', '{'],
    ['an unknown channel', JSON.stringify({ channel: 'fax', identifier: 'mona@firm.example', token: '123456' })],
    ['a missing token', JSON.stringify({ channel: 'email', identifier: 'mona@firm.example' })],
    ['a token that is not a string', JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: 123456 })],
    ['a token over 16 characters', JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: '1'.repeat(17) })],
    ['a return other than site', JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: '123456', return: '/admin' })],
    ['a well-formed body over 4 KiB', JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', token: '123456', padding: 'x'.repeat(5000) })],
  ])('answers %s 400 malformed', async (_case, body) => {
    expect(await verify(body)).toEqual({ status: 400, body: { ok: false, error: 'malformed' } });
    expect(doubles.createServerClient).not.toHaveBeenCalled();
  });

  it('answers a thrown core 500 with a reference that finds its log line', async () => {
    doubles.supabaseAuth.verifyOtp.mockRejectedValueOnce(new TypeError('fetch failed'));
    const { status, body } = await verify(EMAIL_CODE);
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(logged).toHaveBeenCalledWith('otp verify route failed', expect.objectContaining({ reference: body.reference }));
  });
});
