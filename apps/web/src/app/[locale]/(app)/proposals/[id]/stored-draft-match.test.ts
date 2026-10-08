import { describe, expect, it } from 'vitest';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';
import { receiptOfStored, storedDraftMatches } from './stored-draft-match';

const sent: ProposalDraftState = {
  id: 'p-1',
  discountPct: '5',
  taxRate: '14',
  supervisionPct: '0',
  seeMargin: false,
  sections: [
    {
      key: 's-1',
      id: null,
      titleEn: 'Floors',
      titleAr: '',
      lines: [
        { key: 'k-1', id: null, costItemId: 'ci-1', descriptionEn: '', descriptionAr: '', qty: '12', unit: 'sqm', unitCost: '60', unitPrice: '450', discountPct: '0' },
      ],
    },
  ],
};

const stored = {
  revision: 'r-9',
  discountPct: '5.0000',
  taxRate: '14.0000',
  supervisionPct: '0.0000',
  sections: [
    {
      id: 's-1',
      titleEn: 'Floors',
      titleAr: null,
      sortOrder: 0,
      sectionSubtotal: '5400.0000',
      lines: [
        { id: 'l-1', costItemId: 'ci-1', descriptionEn: 'Porcelain (price book)', descriptionAr: null, qty: '12.0000', unit: 'sqm', unitPrice: '450.0000', discountPct: '0.0000', lineTotal: '5400.0000', sortOrder: 0 },
      ],
    },
  ],
};

describe('storedDraftMatches', () => {
  it('the stored form of what was sent matches (figures as numbers, server-filled names, hidden cost)', () => {
    expect(storedDraftMatches(stored, buildProposalPayload(sent))).toBe(true);
  });

  it.each([
    ['a figure', { qty: '13' }],
    ['the unit', { unit: 'pcs' }],
    ['a typed description', { descriptionEn: 'Marble' }],
  ])('a different %s is a real conflict', (_name, change) => {
    const other = { ...sent, sections: [{ ...sent.sections[0], lines: [{ ...sent.sections[0].lines[0], ...change }] }] };
    expect(storedDraftMatches(stored, buildProposalPayload(other))).toBe(false);
  });

  it('a different header or another line is a real conflict', () => {
    expect(storedDraftMatches(stored, buildProposalPayload({ ...sent, taxRate: '0' }))).toBe(false);
    const twoLines = { ...sent, sections: [{ ...sent.sections[0], lines: [...sent.sections[0].lines, sent.sections[0].lines[0]] }] };
    expect(storedDraftMatches(stored, buildProposalPayload(twoLines))).toBe(false);
  });

  it('the stored draft reads as a receipt', () => {
    expect(receiptOfStored(stored)).toEqual({ revision: 'r-9', sections: [{ id: 's-1', lineIds: ['l-1'] }] });
  });
});
