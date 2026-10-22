import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeRejection } from '@/lib/actions/error-message';
import { sendEmailOtp, sendPhoneOtp, verifyEmailOtp, verifyPhoneOtp } from './otp-client';

// The login form's calls to the sign-in code routes. A rejection must read as
// the server actions' did: a dropped connection is "unreachable", an answer
// that is not the JSON contract (a platform error page) is "generic", and any
// JSON answer with a boolean `ok` is the answer, whatever its status.

const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const translate = (key: string) => key;

describe('otp-client', () => {
  it('posts the send request as same-origin, uncached JSON', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    expect(await sendEmailOtp('mona@firm.example')).toEqual({ ok: true });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/auth/otp/send');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'email', identifier: 'mona@firm.example' });
  });

  it('names the channel and the code for each call', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await sendPhoneOtp('+201001234567');
    await verifyEmailOtp('mona@firm.example', '123456');
    await verifyPhoneOtp('+201001234567', '654321');
    const sent = fetchMock.mock.calls.map(([path, init]) => [path, JSON.parse(init.body as string)]);
    expect(sent).toEqual([
      ['/api/auth/otp/send', { channel: 'phone', identifier: '+201001234567' }],
      ['/api/auth/otp/verify', { channel: 'email', identifier: 'mona@firm.example', token: '123456' }],
      ['/api/auth/otp/verify', { channel: 'phone', identifier: '+201001234567', token: '654321' }],
    ]);
  });

  it('returns a verify answer with its next path', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, next: '/onboarding' }));
    expect(await verifyEmailOtp('mona@firm.example', '123456')).toEqual({ ok: true, next: '/onboarding' });
  });

  it.each([
    [200, { ok: false, error: 'check_fields', fields: { email: { code: 'email_format' } } }],
    [400, { ok: false, error: 'malformed' }],
    [403, { ok: false, error: 'forbidden' }],
    [500, { ok: false, error: 'generic', reference: 'ABCD1234' }],
  ])('returns a JSON answer at status %s as is', async (status, body) => {
    fetchMock.mockResolvedValue(json(body, status));
    expect(await sendEmailOtp('mona@firm.example')).toEqual(body);
  });

  it('a dropped connection rejects with the TypeError, which reads as unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const rejection = await sendEmailOtp('mona@firm.example').catch((thrown: unknown) => thrown);
    expect(rejection).toBeInstanceOf(TypeError);
    expect(describeRejection(rejection, translate)).toBe('unreachable');
  });

  it.each([
    ['an HTML error page', new Response('<html>Error 1102</html>', { status: 503, headers: { 'content-type': 'text/html' } }), 503],
    ['a 405 with no body', new Response(null, { status: 405 }), 405],
    ['JSON without a boolean ok', json({ error: 'Forbidden' }, 403), 403],
    ['a JSON content type with a broken body', new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), 200],
  ])('%s rejects with a plain Error, which reads as generic', async (_case, response, status) => {
    fetchMock.mockResolvedValue(response);
    const rejection = await verifyEmailOtp('mona@firm.example', '123456').catch((thrown: unknown) => thrown);
    expect(rejection).toEqual(new Error(`auth endpoint answered ${status}`));
    expect(rejection).not.toBeInstanceOf(TypeError);
    expect(describeRejection(rejection, translate)).toBe('generic');
  });
});
