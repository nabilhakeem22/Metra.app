import { describe, expect, it } from 'vitest';
import { finalAccountTax, type FinalAccountTaxInput } from './final-account-tax';

// The 124,000 contract (VAT 14,000 on works 100,000, supervision 10). Billed so
// far: 62,000 + 37,200 (VAT 7,000 + 4,200) and one change order of 10,000
// (12,400, VAT 1,400). A provisional line measured 4,000 over adds 4,960.
const base: FinalAccountTaxInput = {
  contractTaxAmount: '14000',
  taxRate: '14',
  supervisionPct: '10',
  approvedVariationNetDeltas: ['10000'],
  adjustmentWorks: '4000',
  issuedRequestsTax: '12600',
  // 124,000 + 12,400 + 4,960 - 111,600
  amount: '29760',
};

describe('finalAccountTax', () => {
  it('is every VAT of the final value not yet billed', () => {
    // 14,000 + 1,400 + 560 - 12,600
    expect(finalAccountTax(base)).toBe('3360.0000');
  });

  it('a measured shortfall and a de-scope lower it', () => {
    expect(finalAccountTax({ ...base, approvedVariationNetDeltas: ['10000', '-2000'], adjustmentWorks: '-1000', amount: '20000' })).toBe('2380.0000');
  });

  it('stays inside the request: never below zero, never past its amount', () => {
    expect(finalAccountTax({ ...base, issuedRequestsTax: '99999' })).toBe('0.0000');
    expect(finalAccountTax({ ...base, amount: '100' })).toBe('100.0000');
  });

  it('a contract with no VAT bills none', () => {
    expect(finalAccountTax({ ...base, contractTaxAmount: '0', taxRate: '0', issuedRequestsTax: '0' })).toBe('0.0000');
  });
});
