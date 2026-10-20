import { describe, expect, it } from 'vitest';
import { contractChargeFieldErrors, readContractCharges } from './charges-input';

describe('readContractCharges', () => {
  it('keeps a rate of up to 4 decimals as typed', () => {
    expect(readContractCharges({ taxRate: '14.1234', supervisionPct: '0' })).toEqual({
      ok: true,
      values: { taxRate: '14.1234', supervisionPct: '0' },
    });
  });

  it('refuses a 5th decimal under its box, never cutting it (A3 F8: 100.00001 is not 100)', () => {
    for (const typed of ['100.00001', '14.00001', '0.00001', '14.123400']) {
      expect(contractChargeFieldErrors({ taxRate: typed, supervisionPct: '0' }), typed).toEqual({
        taxRate: { code: 'too_many_decimals', params: { max: 4 } },
      });
    }
    expect(contractChargeFieldErrors({ taxRate: '0', supervisionPct: '10.55555' })).toEqual({
      supervisionPct: { code: 'too_many_decimals', params: { max: 4 } },
    });
  });

  it('still says not_a_number and out_of_range first for what they cover', () => {
    expect(contractChargeFieldErrors({ taxRate: 'abc', supervisionPct: '101' })).toEqual({
      taxRate: { code: 'not_a_number' },
      supervisionPct: { code: 'out_of_range', params: { min: 0, max: 100 } },
    });
  });
});
