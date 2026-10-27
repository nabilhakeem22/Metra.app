import { describe, expect, it } from 'vitest';
import { canonicalOtpIdentifier } from './otp-identifier';

// Go-live security fix round, T5: the one canonical identifier, which is both
// the per-address throttle key and the value Supabase receives.

describe('canonicalOtpIdentifier', () => {
  it.each(['mona@firm.example', 'MONA@FIRM.EXAMPLE', ' Mona@Firm.Example ', 'mona@firm.example\t'])('folds the address %j to one form', (typed) => {
    expect(canonicalOtpIdentifier('email', typed)).toBe('mona@firm.example');
  });

  it.each(['+201001234567', '201001234567', '+20 100 123 4567', '+20 1001234567', '+20-100-123-4567', ' +20 (100) 123-4567 ', '+٢٠١٠٠١٢٣٤٥٦٧'])(
    'folds the phone %j to + and its digits',
    (typed) => {
      expect(canonicalOtpIdentifier('phone', typed)).toBe('+201001234567');
    },
  );

  it('keeps a phone with no digit empty, so the pre-check says it is required', () => {
    expect(canonicalOtpIdentifier('phone', ' + - ')).toBe('');
  });

  it('is idempotent: the canonical form is its own canonical form', () => {
    expect(canonicalOtpIdentifier('phone', canonicalOtpIdentifier('phone', '+20 100 123 4567'))).toBe('+201001234567');
    expect(canonicalOtpIdentifier('email', canonicalOtpIdentifier('email', ' A@B.C '))).toBe('a@b.c');
  });
});
