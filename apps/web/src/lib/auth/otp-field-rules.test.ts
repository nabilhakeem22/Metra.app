import { describe, expect, it } from 'vitest';
import { MAX_IDENTIFIER_LENGTH, otpIdentifierErrors } from './otp-field-rules';
import { parseOtpSendRequest } from './otp-contract';

// The form's pre-check refuses an identifier the endpoint would answer
// "malformed", so the person reads why under the box instead of a page error.

const emailOf = (length: number) => `${'a'.repeat(length - '@firm.example'.length)}@firm.example`;

describe('otpIdentifierErrors: length', () => {
  it('accepts an address of exactly the endpoint limit', () => {
    expect(otpIdentifierErrors('email', emailOf(MAX_IDENTIFIER_LENGTH))).toEqual({});
    expect(parseOtpSendRequest({ channel: 'email', identifier: emailOf(MAX_IDENTIFIER_LENGTH) })).not.toBeNull();
  });

  it.each(['email', 'phone'] as const)('says too_long under the %s box one character past it', (channel) => {
    const identifier = channel === 'email' ? emailOf(MAX_IDENTIFIER_LENGTH + 1) : '1'.repeat(MAX_IDENTIFIER_LENGTH + 1);
    expect(otpIdentifierErrors(channel, identifier)).toEqual({
      [channel]: { code: 'too_long', params: { max: MAX_IDENTIFIER_LENGTH } },
    });
    expect(parseOtpSendRequest({ channel, identifier })).toBeNull();
  });

  it('measures what is sent, spaces included, as the endpoint does', () => {
    const padded = ` ${emailOf(MAX_IDENTIFIER_LENGTH)}`;
    expect(otpIdentifierErrors('email', padded)).toEqual({ email: { code: 'too_long', params: { max: MAX_IDENTIFIER_LENGTH } } });
    expect(parseOtpSendRequest({ channel: 'email', identifier: padded })).toBeNull();
  });

  it('still says required for an empty box, however long its spaces', () => {
    expect(otpIdentifierErrors('email', ' '.repeat(MAX_IDENTIFIER_LENGTH + 5))).toEqual({ email: { code: 'required' } });
  });
});

describe('otpIdentifierErrors: phone (F2)', () => {
  it.each(['+201001234567', '0100 123 4567', '+20 (100) 123-4567', '+20.100.123.4567', '+٢٠١٠٠١٢٣٤٥٦٧'])('accepts %j', (typed) => {
    expect(otpIdentifierErrors('phone', typed)).toEqual({});
  });

  it.each(['+20 1OO 123 4567', '+20 100 123 4567 ext 9', 'owner@firm.example', 'abc', '+', ' + - ', '20+100'])(
    'says phone_format, never required, under a filled phone box: %j',
    (typed) => {
      expect(otpIdentifierErrors('phone', typed)).toEqual({ phone: { code: 'phone_format' } });
    },
  );

  it('still says required for an empty phone box', () => {
    expect(otpIdentifierErrors('phone', '   ')).toEqual({ phone: { code: 'required' } });
  });
});
