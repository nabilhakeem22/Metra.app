import { describe, expect, it } from 'vitest';
import { isTransientResendError, resendRefusalOf } from './resend-failure';

describe('isTransientResendError', () => {
  it('a 4xx refusal is not transient: an unverified domain, a bad recipient', () => {
    expect(isTransientResendError({ statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address' })).toBe(false);
    expect(isTransientResendError({ statusCode: 422, name: 'invalid_parameter' })).toBe(false);
  });

  it('a 429 is transient: the rate limit passes, and the same send goes through later (H5 reliability R6)', () => {
    expect(isTransientResendError({ statusCode: 429, name: 'rate_limit_exceeded' })).toBe(true);
  });

  it('a 5xx, a network failure or an unreadable answer is transient', () => {
    expect(isTransientResendError({ statusCode: 500, name: 'internal_server_error' })).toBe(true);
    expect(isTransientResendError({ statusCode: 503, name: 'application_error' })).toBe(true);
    expect(isTransientResendError({ name: 'application_error', message: 'Unable to fetch data.' })).toBe(true);
    expect(isTransientResendError(null)).toBe(true);
  });
});

describe('resendRefusalOf', () => {
  it('keeps the status and the name, never the message', () => {
    const refusal = resendRefusalOf({ statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to client@example.org' });
    expect(refusal).toEqual({ statusCode: 403, name: 'validation_error' });
    expect(JSON.stringify(refusal)).not.toContain('client@example.org');
  });

  it('answers null for what the error does not carry, and cuts a long name', () => {
    expect(resendRefusalOf(null)).toEqual({ statusCode: null, name: null });
    expect(resendRefusalOf({ statusCode: '403', name: 7 })).toEqual({ statusCode: null, name: null });
    expect(resendRefusalOf({ name: 'x'.repeat(200) }).name).toHaveLength(64);
  });
});
