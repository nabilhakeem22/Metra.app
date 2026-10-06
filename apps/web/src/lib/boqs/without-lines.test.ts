import { describe, expect, it } from 'vitest';
import type { BoqDetail, BoqLineRow } from './queries/types';
import { withoutLines } from './without-lines';

const line = (id: string, lineTotal: string): BoqLineRow => ({
  id,
  itemCode: null,
  description: id,
  unit: 'sqm',
  qty: '1.0000',
  unitPrice: lineTotal,
  discountPct: '0.0000',
  lineTotal,
  provisional: false,
});

const boq: BoqDetail = {
  id: 'b',
  number: 1,
  documentNumber: 'BQ-2026-0001',
  version: 1,
  title: 'BOQ',
  status: 'draft',
  source: 'manual',
  currency: 'EGP',
  discountPct: '10.0000',
  subtotal: '300.0000',
  discountAmount: '30.0000',
  total: '270.0000',
  lineCount: 3,
  sections: [
    { id: 's1', title: 'A', sectionSubtotal: '200.0000', lines: [line('keep', '100.0000'), line('stray', '100.0000')] },
    { id: 's2', title: 'B', sectionSubtotal: '100.0000', lines: [line('other', '100.0000')] },
  ],
};

describe('withoutLines: a line held for Undo is gone from every figure', () => {
  it('returns the BOQ untouched when nothing is hidden', () => {
    expect(withoutLines(boq, new Set())).toBe(boq);
  });

  it('drops the line and recomputes the section, totals and count', () => {
    const shown = withoutLines(boq, new Set(['stray']));
    expect(shown.sections[0]!.lines.map((l) => l.id)).toEqual(['keep']);
    expect(shown.sections[0]!.sectionSubtotal).toBe('100.0000');
    expect(shown.sections[1]).toBe(boq.sections[1]);
    expect(shown.lineCount).toBe(2);
    expect(shown.subtotal).toBe('200.0000');
    expect(shown.discountAmount).toBe('20.0000');
    expect(shown.total).toBe('180.0000');
  });

  it('hiding every line leaves a zero BOQ with no lines', () => {
    const shown = withoutLines(boq, new Set(['keep', 'stray', 'other']));
    expect(shown.lineCount).toBe(0);
    expect(shown.total).toBe('0.0000');
  });
});
