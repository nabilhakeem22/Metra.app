import { describe, expect, it } from 'vitest';
import { buildCostSheet } from './cost-sheet';
import type { CostSheetInput } from './cost-sheet-types';

// A 100,000 BOQ contract with VAT 14 and supervision 10 (original 124,000),
// one approved change order of net 10,000 whose lines (new scope, on no
// contract line) cost 6,000. Projected margin is PER SECTION (owner decision
// Oct 19): every expectation below is derived under that rule.
const input: CostSheetInput = {
  originalValue: '124000',
  taxAmount: '14000',
  taxRate: '14',
  supervisionPct: '10',
  approvedVariationNetDeltas: ['10000'],
  sections: [
    { sectionId: 'a', titleAr: 'نجارة', titleEn: 'Joinery', budgetCost: '40000', variationBudgetCost: '0', actualCost: '45000' },
    { sectionId: 'b', titleAr: 'دهانات', titleEn: null, budgetCost: '30000', variationBudgetCost: '0', actualCost: '20000' },
  ],
  moreSections: null,
  newScopeVariationsCost: '6000',
  unallocatedActualCost: '3000',
  requestedTotal: '74400',
  paidTotal: '50000',
};

const oneSection = (overrides: Partial<CostSheetInput['sections'][number]>): CostSheetInput['sections'] => [
  { sectionId: 'a', titleAr: null, titleEn: 'A', budgetCost: '70000', variationBudgetCost: '0', actualCost: '0', ...overrides },
];

describe('buildCostSheet', () => {
  it('values the contract with the change orders, and ex VAT', () => {
    expect(buildCostSheet(input, true).value).toEqual({
      originalValue: '124000.0000',
      approvedVariations: '12400.0000',
      revisedValue: '136400.0000',
      // 124,000 - 14,000 VAT + 10,000 works + 1,000 supervision
      valueExVat: '121000.0000',
    });
  });

  it('lists the sections, then the whole-contract and change-order rows', () => {
    const { sections } = buildCostSheet(input, true);
    expect(sections.map((row) => [row.kind, row.sectionId, row.budgetCost, row.actualCost, row.variance, row.overBudget])).toEqual([
      ['section', 'a', '40000.0000', '45000.0000', '5000.0000', true],
      ['section', 'b', '30000.0000', '20000.0000', '-10000.0000', false],
      ['whole_contract', null, '0.0000', '3000.0000', '3000.0000', true],
      ['change_orders', null, '6000.0000', null, null, false],
    ]);
    expect(sections[0]).toMatchObject({ titleAr: 'نجارة', titleEn: 'Joinery', count: null });
  });

  it('totals equal the sums of the rows to the piastre', () => {
    expect(buildCostSheet(input, true).totals).toEqual({ budgetCost: '76000.0000', actualCost: '68000.0000' });
  });

  it('planned margin is against the budget; projected takes each section at max(budget, actual)', () => {
    const { margin } = buildCostSheet(input, true);
    // planned 121,000 - 76,000. projected 121,000 - (45,000 + 30,000 + 6,000 + 3,000):
    // the section under budget no longer offsets the one over it.
    expect(margin?.planned).toBe('45000.0000');
    expect(margin?.projected).toBe('37000.0000');
    expect(margin?.plannedPct).toBeCloseTo(37.19, 2);
    expect(margin?.projectedPct).toBeCloseTo(30.58, 2);
  });

  it('projected margin falls with every piastre a section spends past its budget', () => {
    const over = { ...input, sections: [{ ...input.sections[0], actualCost: '60000' }, input.sections[1]] };
    // 121,000 - (60,000 + 30,000 + 6,000 + 3,000)
    expect(buildCostSheet(over, true).margin?.projected).toBe('22000.0000');
  });

  it('F3: a de-scope of a section\'s lines lowers its budget; with nothing spent projected equals planned', () => {
    const sheet = buildCostSheet(
      {
        ...input,
        approvedVariationNetDeltas: ['-10000'],
        sections: oneSection({ variationBudgetCost: '-8000' }),
        newScopeVariationsCost: '0',
        unallocatedActualCost: '0',
      },
      true,
    );
    // value ex VAT 124,000 - 14,000 - 10,000 - 1,000 = 99,000 ; budget 70,000 - 8,000
    expect(sheet.totals.budgetCost).toBe('62000.0000');
    expect(sheet.margin).toMatchObject({ planned: '37000.0000', projected: '37000.0000' });
    expect(sheet.sections).toEqual([
      { kind: 'section', sectionId: 'a', titleAr: null, titleEn: 'A', count: null, budgetCost: '62000.0000', actualCost: '0.0000', variance: '-62000.0000', overBudget: false },
    ]);
  });

  it('a new-scope de-scope counts as nothing in projected cost (max against 0), and lowers planned', () => {
    const sheet = buildCostSheet(
      { ...input, approvedVariationNetDeltas: ['-10000'], sections: oneSection({}), newScopeVariationsCost: '-8000', unallocatedActualCost: '0' },
      true,
    );
    // planned 99,000 - 62,000 ; projected 99,000 - (70,000 + max(-8,000, 0))
    expect(sheet.margin).toMatchObject({ planned: '37000.0000', projected: '29000.0000' });
  });

  it('F4 (70,000 / 6,000 / 76,000): a change order on the section\'s own lines takes its section', () => {
    const sheet = buildCostSheet(
      { ...input, sections: oneSection({ variationBudgetCost: '6000', actualCost: '76000' }), newScopeVariationsCost: '0', unallocatedActualCost: '0' },
      true,
    );
    // 121,000 - max(70,000 + 6,000, 76,000): the section spent its revised budget exactly.
    expect(sheet.margin).toMatchObject({ planned: '45000.0000', projected: '45000.0000' });
    expect(sheet.sections[0]).toMatchObject({ budgetCost: '76000.0000', variance: '0.0000', overBudget: false });
    expect(sheet.sections.map((row) => row.kind)).toEqual(['section']);
  });

  it('F4 (70,000 / 6,000 / 76,000): new-scope work booked to a section counts in both rows', () => {
    const sheet = buildCostSheet(
      { ...input, sections: oneSection({ actualCost: '76000' }), newScopeVariationsCost: '6000', unallocatedActualCost: '0' },
      true,
    );
    // 121,000 - (max(70,000, 76,000) + max(6,000, 0))
    expect(sheet.margin).toMatchObject({ planned: '45000.0000', projected: '39000.0000' });
    expect(sheet.sections[0]).toMatchObject({ variance: '6000.0000', overBudget: true });
  });

  it('the folded sections past the cap count by their own per-section figure', () => {
    const sheet = buildCostSheet(
      { ...input, moreSections: { count: 3, budgetCost: '9000', actualCost: '8000', projectedCost: '10000' } },
      true,
    );
    expect(sheet.sections[2]).toEqual({
      kind: 'more_sections', sectionId: null, titleAr: null, titleEn: null, count: 3,
      budgetCost: '9000.0000', actualCost: '8000.0000', variance: '-1000.0000', overBudget: false,
    });
    expect(sheet.totals).toEqual({ budgetCost: '85000.0000', actualCost: '76000.0000' });
    // 121,000 - (45,000 + 30,000 + 10,000 + 6,000 + 3,000)
    expect(sheet.margin?.projected).toBe('27000.0000');
  });

  it('hides the margin from a reader who may not see it', () => {
    const sheet = buildCostSheet(input, false);
    expect(sheet.margin).toBeNull();
    expect(sheet.totals.budgetCost).toBe('76000.0000');
  });

  it('bills: requested, paid and what is still outstanding', () => {
    expect(buildCostSheet(input, true).billing).toEqual({
      requested: '74400.0000',
      paid: '50000.0000',
      outstanding: '24400.0000',
    });
  });

  it('omits the whole-contract and change-order rows when they hold no money', () => {
    const bare = { ...input, approvedVariationNetDeltas: [], newScopeVariationsCost: '0', unallocatedActualCost: '0' };
    const sheet = buildCostSheet(bare, true);
    expect(sheet.sections.map((row) => row.kind)).toEqual(['section', 'section']);
    expect(sheet.value.revisedValue).toBe('124000.0000');
    expect(sheet.value.valueExVat).toBe('110000.0000');
  });

  it('a de-scope lowers the revised value and the value ex VAT', () => {
    const sheet = buildCostSheet({ ...input, approvedVariationNetDeltas: ['10000', '-4000'] }, true);
    // 12,400 - 4,960 ; 121,000 - 4,000 - 400
    expect(sheet.value.approvedVariations).toBe('7440.0000');
    expect(sheet.value.valueExVat).toBe('116600.0000');
  });

  it('rounds each order as it is billed (the revised value of the final account and the contract page)', () => {
    const sheet = buildCostSheet({ ...input, approvedVariationNetDeltas: ['10000', '10000', '0', '1000.0043', '-500'] }, true);
    expect(sheet.value.approvedVariations).toBe('25420.0053');
  });

  it('has no margin percentage on a contract with no value', () => {
    const empty = { ...input, originalValue: '0', taxAmount: '0', approvedVariationNetDeltas: [] };
    expect(buildCostSheet(empty, true).margin?.plannedPct).toBeNull();
  });
});
