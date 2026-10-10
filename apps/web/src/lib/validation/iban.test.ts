import { describe, expect, it } from 'vitest';
import { ibanChecksumHolds } from './iban';

describe('ibanChecksumHolds', () => {
  it.each(['EG380019000500000000263180002', 'GB82WEST12345698765432', 'DE89370400440532013000'])(
    'accepts the published example %s',
    (iban) => {
      expect(ibanChecksumHolds(iban)).toBe(true);
    },
  );

  it('refuses one mistyped digit and two swapped neighbours', () => {
    expect(ibanChecksumHolds('EG380019000500000000263180003')).toBe(false);
    expect(ibanChecksumHolds('EG380019000500000000263180020')).toBe(false);
  });

  it.each(['', 'EG38', 'eg380019000500000000263180002', 'EG38 0019 0005'])('refuses %j', (iban) => {
    expect(ibanChecksumHolds(iban)).toBe(false);
  });
});
