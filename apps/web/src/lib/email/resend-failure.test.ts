import { describe, expect, it } from 'vitest';
import { isTransientResendError } from './resend-failure';

describe('isTransientResendError', () => {
  it('a 4xx refusal is not transient: an unverified domain, a bad recipient, a rate limit', () => {
    expect(isTransientResendError({ statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address' })).toBe(false);
    expect(isTransientResendError({ statusCode: 422, name: 'invalid_parameter' })).toBe(false);
    expect(isTransientResendError({ statusCode: 429, name: 'rate_limit_exceeded' })).toBe(false);
  });

  it('a 5xx, a network failure or an unreadable answer is transient', () => {
    expect(isTransientResendError({ statusCode: 500, name: 'internal_server_error' })).toBe(true);
    expect(isTransientResendError({ statusCode: 503, name: 'application_error' })).toBe(true);
    expect(isTransientResendError({ name: 'application_error', message: 'Unable to fetch data.' })).toBe(true);
    expect(isTransientResendError(null)).toBe(true);
  });
});
