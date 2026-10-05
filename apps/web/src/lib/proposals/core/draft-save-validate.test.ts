// `pricingForKind` is the server-side half of "a BOQ is priced before VAT and
// supervision": whatever the browser sends, a BOQ proposal saves with both at 0.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/mutate', () => ({
  fail: (code: string) => {
    throw new Error(code);
  },
}));

import { pricingForKind, type ResolvedHeader } from './draft-save-validate';

const header: ResolvedHeader = {
  discountPct: '5',
  taxRate: '14',
  supervisionPct: '10',
  titleEn: 'Bill of Quantities',
  titleAr: null,
  issueDate: null,
  expiryDate: null,
  currency: 'EGP',
  notesAr: null,
  notesEn: null,
  termsAr: null,
  termsEn: null,
};

describe('pricingForKind', () => {
  it('forces VAT and supervision to 0 on a BOQ proposal, and keeps the rest', () => {
    expect(pricingForKind('boq', header)).toEqual({
      ...header,
      taxRate: '0',
      supervisionPct: '0',
    });
  });

  it('leaves a quote exactly as validated', () => {
    expect(pricingForKind('quote', header)).toBe(header);
  });
});
