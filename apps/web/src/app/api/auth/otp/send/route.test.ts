import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as doubles from '@/test/otp-route-doubles';
import { otpPost } from '@/test/otp-route-doubles';

// POST /api/auth/otp/send (AC5): the sendEmailOtp / sendPhoneOtp answers over
// a same-origin JSON route, because the static login page cannot post server
// actions. The real route, core and failure mapping run; Supabase is a double.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', async () => ({ cookies: async () => (await import('@/test/otp-route-doubles')).cookieStore }));
vi.mock('@supabase/ssr', async () => ({ createServerClient: (await import('@/test/otp-route-doubles')).createServerClient }));
vi.mock('@/lib/db/context', async () => ({ withUserContext: (await import('@/test/otp-route-doubles')).withUserContext }));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { POST, dynamic } = await import('./route');

const PATH = '/api/auth/otp/send';
const EMAIL = JSON.stringify({ channel: 'email', identifier: 'mona@firm.example' });
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

async function send(body: string, headers?: Record<string, string | undefined>) {
  const response = await POST(otpPost(PATH, body, headers));
  expect(response.headers.get('cache-control')).toBe('no-store');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  doubles.resetOtpRouteDoubles();
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe('POST /api/auth/otp/send', () => {
  it('is always rendered on request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('sends an email code and answers ok', async () => {
    expect(await send(EMAIL)).toEqual({ status: 200, body: { ok: true } });
    expect(doubles.supabaseAuth.signInWithOtp).toHaveBeenCalledWith({ email: 'mona@firm.example', options: { shouldCreateUser: true } });
  });

  it('sends a phone code by SMS', async () => {
    expect(await send(JSON.stringify({ channel: 'phone', identifier: '+201001234567' }))).toEqual({ status: 200, body: { ok: true } });
    expect(doubles.supabaseAuth.signInWithOtp).toHaveBeenCalledWith({ phone: '+201001234567' });
  });

  it.each<[string, Record<string, string | undefined>]>([
    ['no Origin', { origin: undefined }],
    ['a cross-host Origin', { origin: 'https://evil.example' }],
    ['an opaque Origin', { origin: 'null' }],
    ['a text/plain body', { 'content-type': 'text/plain' }],
    ['no content type', { 'content-type': undefined }],
  ])('refuses %s with 403 before calling Supabase', async (_case, headers) => {
    expect(await send(EMAIL, headers)).toEqual({ status: 403, body: { ok: false, error: 'forbidden' } });
    expect(doubles.createServerClient).not.toHaveBeenCalled();
  });

  it('accepts a JSON content type with a charset', async () => {
    expect((await send(EMAIL, { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200);
  });

  it.each([
    ['a body that is not JSON', '{'],
    ['an unknown channel', JSON.stringify({ channel: 'fax', identifier: 'mona@firm.example' })],
    ['a missing identifier', JSON.stringify({ channel: 'email' })],
    ['an array', JSON.stringify(['email', 'mona@firm.example'])],
    ['an identifier over 320 characters', JSON.stringify({ channel: 'email', identifier: `${'a'.repeat(310)}@firm.example` })],
    ['a well-formed body over 4 KiB', JSON.stringify({ channel: 'email', identifier: 'mona@firm.example', padding: 'x'.repeat(5000) })],
  ])('answers %s 400 malformed', async (_case, body) => {
    expect(await send(body)).toEqual({ status: 400, body: { ok: false, error: 'malformed' } });
    expect(doubles.createServerClient).not.toHaveBeenCalled();
  });

  it('refuses a malformed email under the email box, as the action did', async () => {
    expect(await send(JSON.stringify({ channel: 'email', identifier: 'not-an-address' }))).toEqual({
      status: 200,
      body: { ok: false, error: 'check_fields', fields: { email: { code: 'email_format' } } },
    });
    expect(doubles.supabaseAuth.signInWithOtp).not.toHaveBeenCalled();
  });

  it.each(['+20 1OO 123 4567', '+20 100 123 4567 ext 9', 'owner@firm.example', 'abc', ' + - '])(
    'refuses the phone %j as phone_format and never texts a number nobody typed (F2)',
    async (typed) => {
      expect(await send(JSON.stringify({ channel: 'phone', identifier: typed }))).toEqual({
        status: 200,
        body: { ok: false, error: 'check_fields', fields: { phone: { code: 'phone_format' } } },
      });
      expect(doubles.supabaseAuth.signInWithOtp).not.toHaveBeenCalled();
    },
  );

  it('answers a Supabase rate limit with its code', async () => {
    doubles.supabaseAuth.signInWithOtp.mockResolvedValueOnce({ error: { code: 'over_email_send_rate_limit', status: 429 } });
    expect(await send(EMAIL)).toEqual({ status: 200, body: { ok: false, error: 'otp_rate_limited' } });
  });

  it('answers a thrown core 500 with a reference that finds its log line', async () => {
    doubles.supabaseAuth.signInWithOtp.mockRejectedValueOnce(new TypeError('fetch failed'));
    const { status, body } = await send(EMAIL);
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(logged).toHaveBeenCalledWith('otp send route failed', expect.objectContaining({ reference: body.reference }));
  });
});
