import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { otpSendFailure, otpVerifyFailure } from './otp-failure';

vi.mock('server-only', () => ({}));

// AC 28, server half: each Supabase cause the person can act on gets its own
// answer, and the one log line carries the code and HTTP status, never the
// provider's message (which can echo the typed address).

const ADDRESS = 'mona@firm.example';
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

/** A Supabase AuthError as it arrives: its message may carry the address. */
function supabaseError(code: string | undefined, status: number) {
  return Object.assign(new Error(`Error sending code to ${ADDRESS}`), { code, status });
}

function loggedText(): string {
  return JSON.stringify(logged.mock.calls);
}

describe('otpSendFailure', () => {
  it.each(['over_email_send_rate_limit', 'over_sms_send_rate_limit', 'over_request_rate_limit'])(
    '%s is otp_rate_limited',
    (code) => {
      expect(otpSendFailure('send', supabaseError(code, 429), 'email')).toEqual({
        ok: false,
        error: 'otp_rate_limited',
      });
    },
  );

  it('an invalid address is email_format under the email box', () => {
    expect(otpSendFailure('send', supabaseError('email_address_invalid', 400), 'email')).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { email: { code: 'email_format' } },
    });
  });

  it('a phone the provider will not take is phone_invalid under the phone box', () => {
    expect(otpSendFailure('send', supabaseError('validation_failed', 400), 'phone')).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { phone: { code: 'phone_invalid' } },
    });
  });

  it.each([
    ['phone_provider_disabled', 'otp_sms_unavailable'],
    ['sms_send_failed', 'otp_sms_unavailable'],
    ['email_address_not_authorized', 'otp_email_unavailable'],
    ['email_provider_disabled', 'otp_email_unavailable'],
  ])('%s is %s', (code, answer) => {
    expect(otpSendFailure('send', supabaseError(code, 400), 'email')).toEqual({ ok: false, error: answer });
  });

  it('logs the code and status once, never the address', () => {
    otpSendFailure('sendEmailOtp failed', supabaseError('over_email_send_rate_limit', 429), 'email');
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]).toEqual([
      'sendEmailOtp failed',
      { code: 'over_email_send_rate_limit', status: 429 },
    ]);
    expect(loggedText()).not.toContain(ADDRESS);
  });

  it('an unknown cause is generic with a reference, logged once with code and status only', () => {
    const result = otpSendFailure('sendEmailOtp failed', supabaseError('unexpected_failure', 500), 'email');
    expect(result).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(logged).toHaveBeenCalledOnce();
    const [label, payload] = logged.mock.calls[0] as [string, { reference: string; failure: object }];
    expect(label).toBe('sendEmailOtp failed');
    expect(payload.reference).toBe(result.reference);
    expect(payload.failure).toEqual({ name: 'AuthError', code: 'unexpected_failure', message: 'status 500' });
    expect(loggedText()).not.toContain(ADDRESS);
  });

  it('a code that names an Object prototype member is not mistaken for a known cause', () => {
    expect(otpSendFailure('send', supabaseError('constructor', 500), 'email').error).toBe('generic');
  });
});

describe('otpVerifyFailure', () => {
  it('a wrong or expired code is otp_verify_failed under the code boxes (D8)', () => {
    expect(otpVerifyFailure('verify', supabaseError('otp_expired', 403))).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { token: { code: 'otp_verify_failed' } },
    });
  });

  it('too many attempts is otp_rate_limited', () => {
    expect(otpVerifyFailure('verify', supabaseError('over_request_rate_limit', 429)).error).toBe(
      'otp_rate_limited',
    );
  });
});
