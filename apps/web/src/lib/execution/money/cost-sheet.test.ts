import { describe, expect, it } from 'vitest';
import { buildCostSheet, type CostSheetInput } from './cost-sheet';

// A 100,000 BOQ contract with VAT 14 and supervision 10 (original 124,000),
// one approved change order of net 10,000 whose lines cost 6,000.
const input: CostSheetInput = {
  originalValue: '124000',
  taxAmount: '14000',
  taxRate: '14',
  supervisionPct: '10',
  approvedVariationNetDeltas: ['10000'],
  approvedVariationsCost: '6000',
  sections: [
    { sectionId: 'a', titleAr: 'نجارة', titleEn: 'Joinery', budgetCost: '40000', actualCost: '45000' },
    { sectionId: 'b', titleAr: 'دهانات', titleEn: null, budgetCost: '30000', actualCost: '20000' },
  ],
  unallocatedActualCost: '3000',
  requestedTotal: '74400',
  paidTotal: '50000',
};

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
      ['change_orders', null, '6000.0000', '0.0000', '-6000.0000', false],
    ]);
    expect(sections[0]).toMatchObject({ titleAr: 'نجارة', titleEn: 'Joinery' });
  });

  it('totals equal the sums of the rows to the piastre', () => {
    expect(buildCostSheet(input, true).totals).toEqual({ budgetCost: '76000.0000', actualCost: '68000.0000' });
  });

  it('planned margin is against the budget, projected against max(budget, actual) per row', () => {
    const { margin } = buildCostSheet(input, true);
    // 121,000 - 76,000 ; 121,000 - (45,000 + 30,000 + 3,000 + 6,000)
    expect(margin?.planned).toBe('45000.0000');
    expect(margin?.projected).toBe('37000.0000');
    expect(margin?.plannedPct).toBeCloseTo(37.19, 2);
    expect(margin?.projectedPct).toBeCloseTo(30.58, 2);
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
    const bare = { ...input, approvedVariationNetDeltas: [], approvedVariationsCost: '0', unallocatedActualCost: '0' };
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

  it('has no margin percentage on a contract with no value', () => {
    const empty = { ...input, originalValue: '0', taxAmount: '0', approvedVariationNetDeltas: [] };
    expect(buildCostSheet(empty, true).margin?.plannedPct).toBeNull();
  });
});
