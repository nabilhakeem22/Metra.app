import { describe, expect, it } from 'vitest';
import { computeLine, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { countSendable } from './count';
import { toBoqDetail } from './detail';
import {
  mapProposalToBoq,
  type ProposalSourceLine,
  type ProposalSourceSection,
} from './map';

const line = (over: Partial<ProposalSourceLine> = {}): ProposalSourceLine => ({
  costItemId: null,
  itemCode: null,
  descriptionAr: null,
  descriptionEn: 'Gypsum ceiling',
  qty: '100',
  unit: 'sqm',
  unitCost: '900',
  unitPrice: '1500',
  discountPct: '0',
  ...over,
});

const section = (
  lines: ProposalSourceLine[],
  titleEn = 'Ceilings',
): ProposalSourceSection => ({ titleAr: null, titleEn, lines });

describe('mapProposalToBoq', () => {
  it('drops sections with no lines and numbers what is kept', () => {
    const mapped = mapProposalToBoq(
      [section([], 'Empty'), section([line(), line()], 'A'), section([line()], 'B')],
      '0',
    );
    expect(mapped.sections.map((s) => s.titleEn)).toEqual(['A', 'B']);
    expect(mapped.sections.map((s) => s.sortOrder)).toEqual([0, 1]);
    expect(mapped.sections[0].lines.map((l) => l.sortOrder)).toEqual([0, 1]);
    expect(mapped.sectionCount).toBe(2);
    expect(mapped.lineCount).toBe(3);
  });

  it('carries the item code and prices each line with computeLine', () => {
    const source = line({ itemCode: '2.01', qty: '12.5', unitPrice: '220', discountPct: '5' });
    const mapped = mapProposalToBoq([section([source])], '0');
    const mappedLine = mapped.sections[0].lines[0];
    expect(mappedLine.itemCode).toBe('2.01');
    expect(mappedLine.provisional).toBe(false);
    expect({
      lineCost: mappedLine.lineCost,
      lineTotal: mappedLine.lineTotal,
      lineMargin: mappedLine.lineMargin,
    }).toEqual(computeLine(source));
  });

  it('stops at total = subtotal - discountAmount, with no tax field', () => {
    const mapped = mapProposalToBoq([section([line(), line({ qty: '45', unitPrice: '220' })])], '10');
    const { totals } = mapped;
    expect(parseMoney4(totals.total)).toBe(
      parseMoney4(totals.subtotal) - parseMoney4(totals.discountAmount),
    );
    expect(totals.subtotal).toBe('159900.0000');
    expect(totals.discountAmount).toBe('15990.0000');
    expect(Object.keys(totals).sort()).toEqual(
      ['discountAmount', 'subtotal', 'total', 'totalCost', 'totalMargin'].sort(),
    );
    expect(mapped.sections[0].sectionSubtotal).toBe('159900.0000');
  });
});

describe('countSendable', () => {
  it('counts only sections that carry lines, as the mapper keeps them', () => {
    const sections = [section([]), section([line(), line()]), section([line()])];
    expect(countSendable(sections)).toEqual({ sectionCount: 2, lineCount: 3 });
    const mapped = mapProposalToBoq(sections, '0');
    expect(countSendable(sections)).toEqual({
      sectionCount: mapped.sectionCount,
      lineCount: mapped.lineCount,
    });
  });
});

describe('toBoqDetail', () => {
  const mapped = mapProposalToBoq([section([line({ itemCode: '1.1' })])], '0');
  const header = {
    number: 14,
    year: 2026,
    title: 'Bill of Quantities',
    currency: 'EGP',
    discountPct: '0',
  };

  it('leaves cost and margin OFF the object when showCost is false', () => {
    const detail = toBoqDetail(mapped, header, { showCost: false });
    expect(detail).not.toHaveProperty('totalCost');
    expect(detail).not.toHaveProperty('totalMargin');
    const row = detail.sections[0].lines[0];
    expect(row).not.toHaveProperty('unitCost');
    expect(row).not.toHaveProperty('lineCost');
    expect(row).not.toHaveProperty('lineMargin');
    expect(JSON.stringify(detail)).not.toContain('900');
  });

  it('carries cost when asked, synthetic ids, and the header number', () => {
    const detail = toBoqDetail(mapped, header, { showCost: true });
    expect(detail.number).toBe(14);
    expect(detail.documentNumber).toBe('BQ-2026-0014');
    expect(detail.sections[0].id).toBe('s0');
    expect(detail.sections[0].lines[0].id).toBe('s0l0');
    expect(detail.sections[0].lines[0].unitCost).toBe('900');
    expect(detail.totalCost).toBe(mapped.totals.totalCost);
    expect(detail.total).toBe(mapped.totals.total);
    expect(detail.lineCount).toBe(1);
  });
});
