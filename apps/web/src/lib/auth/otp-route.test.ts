import { beforeEach, describe, expect, it, vi } from 'vitest';
import { otpPost } from '@/test/otp-route-doubles';
import { expectRouteHandlerHeaders } from '@/test/route-handler-headers';
import type { OtpIdentity } from './otp-contract';

// C6: every answer of the sign-in code endpoints (403, 400, 429, 500 and the
// core's 200) carries the route-handler security headers, and is still never
// cached. The throttle is a double so each status can be reached.

vi.mock('server-only', () => ({}));
const throttle = vi.hoisted(() => ({ otpThrottleRefusal: vi.fn() }));
vi.mock('./otp-throttle', () => throttle);

const { otpEndpoint } = await import('./otp-route');

const IDENTITY: OtpIdentity = { channel: 'email', identifier: 'mona@firm.example' };
const core = vi.fn();
const POST = otpEndpoint('otp test route failed', 'send', (body) => (body === null ? null : IDENTITY), core);
const post = (body: string, headers?: Record<string, string | undefined>) => POST(otpPost('/api/auth/otp/send', body, headers));

async function expectAnswer(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(body);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expectRouteHandlerHeaders(response);
}

beforeEach(() => {
  throttle.otpThrottleRefusal.mockReset().mockResolvedValue(null);
  core.mockReset().mockResolvedValue({ ok: true });
});

describe('otpEndpoint: the security headers on every answer (C6)', () => {
  it('the core answer, 200', async () => {
    await expectAnswer(await post('{}'), 200, { ok: true });
  });

  it('a foreign Origin, 403', async () => {
    await expectAnswer(await post('{}', { origin: 'https://evil.example' }), 403, { ok: false, error: 'forbidden' });
  });

  it('a body that is not the request shape, 400', async () => {
    await expectAnswer(await post('null'), 400, { ok: false, error: 'malformed' });
  });

  it('past the budget, 429 with its retry-after kept', async () => {
    throttle.otpThrottleRefusal.mockResolvedValue({ status: 429, body: { ok: false, error: 'otp_rate_limited' } });
    const response = await post('{}');
    expect(response.headers.get('retry-after')).toBe('60');
    await expectAnswer(response, 429, { ok: false, error: 'otp_rate_limited' });
    expect(core).not.toHaveBeenCalled();
  });

  it('a core that threw, 500 with its reference', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    core.mockRejectedValue(new Error('boom'));
    await expectAnswer(await post('{}'), 500, { ok: false, error: 'generic', reference: expect.any(String) });
  });
});
