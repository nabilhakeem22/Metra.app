import { describe, expect, test } from 'vitest';
import type { LineState, SectionState } from './builder-model';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

function line(overrides: Partial<LineState> = {}): LineState {
  return {
    id: 'line-1',
    costItemId: 'cost-1',
    descriptionEn: 'Gypsum ceiling',
    descriptionAr: 'سقف جبسوم',
    qty: '4',
    unit: 'sqm',
    unitCost: '1200',
    unitPrice: '2500',
    discountPct: '5',
    ...overrides,
  };
}

function section(lines: LineState[], overrides: Partial<SectionState> = {}): SectionState {
  return { titleEn: 'Ceilings', titleAr: 'الأسقف', lines, ...overrides };
}

function draft(overrides: Partial<ProposalDraftState> = {}): ProposalDraftState {
  return {
    id: 'proposal-1',
    discountPct: '10',
    taxRate: '14',
    supervisionPct: '5',
    sections: [section([line()])],
    seeMargin: true,
    ...overrides,
  };
}

describe('buildProposalPayload — the document a client signs', () => {
  test('carries the proposal id and the three header percentages', () => {
    const payload = buildProposalPayload(draft());
    expect(payload.id).toBe('proposal-1');
    expect(payload.header).toEqual({
      discountPct: '10',
      taxRate: '14',
      supervisionPct: '5',
    });
  });

  test('an EMPTY percentage box becomes 0, never the empty string', () => {
    const payload = buildProposalPayload(
      draft({ discountPct: '', taxRate: '', supervisionPct: '' }),
    );
    expect(payload.header).toEqual({ discountPct: '0', taxRate: '0', supervisionPct: '0' });
  });

  test('an empty TEXT box becomes null, not the empty string', () => {
    const payload = buildProposalPayload(
      draft({ sections: [section([line({ descriptionAr: '' })], { titleEn: '' })] }),
    );
    expect(payload.sections[0]?.titleEn).toBeNull();
    expect(payload.sections[0]?.titleAr).toBe('الأسقف');
    expect(payload.sections[0]?.lines[0]?.descriptionAr).toBeNull();
  });

  test('an empty number box on a LINE becomes 0', () => {
    const payload = buildProposalPayload(
      draft({ sections: [section([line({ qty: '', unitPrice: '', discountPct: '' })])] }),
    );
    expect(payload.sections[0]?.lines[0]).toMatchObject({
      qty: '0',
      unitPrice: '0',
      discountPct: '0',
    });
  });
});

describe('buildProposalPayload — the margin fence', () => {
  // The core keeps the STORED cost by line id when unitCost is null. Sending '0'
  // from a margin-blind role would zero a real cost on a document that has one.
  test('a margin-blind role sends unitCost NULL, never a zero', () => {
    const payload = buildProposalPayload(draft({ seeMargin: false }));
    expect(payload.sections[0]?.lines[0]?.unitCost).toBeNull();
  });

  test('a margin-seeing role sends the typed cost', () => {
    const payload = buildProposalPayload(draft({ seeMargin: true }));
    expect(payload.sections[0]?.lines[0]?.unitCost).toBe('1200');
  });

  test('a margin-seeing role with an emptied cost box sends 0, not null', () => {
    const payload = buildProposalPayload(
      draft({ seeMargin: true, sections: [section([line({ unitCost: '' })])] }),
    );
    expect(payload.sections[0]?.lines[0]?.unitCost).toBe('0');
  });

  test('the line ID is round-tripped either way — it is what preserves stored cost', () => {
    for (const seeMargin of [true, false]) {
      const payload = buildProposalPayload(draft({ seeMargin }));
      expect(payload.sections[0]?.lines[0]?.id).toBe('line-1');
    }
    const fresh = buildProposalPayload(
      draft({ sections: [section([line({ id: null })])] }),
    );
    expect(fresh.sections[0]?.lines[0]?.id).toBeNull();
  });
});

describe('buildProposalPayload — order is ARRAY POSITION', () => {
  test('sortOrder follows the order on screen, for sections and for lines', () => {
    const payload = buildProposalPayload(
      draft({
        sections: [
          section([line({ id: 'a' }), line({ id: 'b' })], { titleEn: 'First' }),
          section([line({ id: 'c' })], { titleEn: 'Second' }),
        ],
      }),
    );
    expect(payload.sections.map((s) => [s.titleEn, s.sortOrder])).toEqual([
      ['First', 0],
      ['Second', 1],
    ]);
    expect(payload.sections[0]?.lines.map((l) => [l.id, l.sortOrder])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(payload.sections[1]?.lines[0]?.sortOrder).toBe(0);
  });

  test('a section with no lines is still sent — it is a heading the studio typed', () => {
    const payload = buildProposalPayload({ ...draft(), sections: [section([])] });
    expect(payload.sections).toHaveLength(1);
    expect(payload.sections[0]?.lines).toEqual([]);
  });

  test('no sections at all is an empty list, not a crash', () => {
    expect(buildProposalPayload(draft({ sections: [] })).sections).toEqual([]);
  });
});
