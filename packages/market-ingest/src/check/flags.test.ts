import { describe, expect, it } from 'vitest';
import type { PublishedHistory } from './context';
import { bulletin, months, page, printedCells, row } from '../testing/fixtures';
import { brief, checkFixture } from '../testing/run';

const withSlots = (...values: Parameters<typeof months>) => {
  const slots = months(...values);
  return bulletin({ pages: [page({ yearly: null, rows: [row({ months: slots, verbatimCells: printedCells(slots) })] })] });
};

describe('market:check flags', () => {
  it('F1: a jump above 15% inside the series, but not one of exactly 15%', () => {
    expect(brief(checkFixture(withSlots('100', '116')))).toEqual(['F1 p2.r1 m2']);
    expect(brief(checkFixture(withSlots('100', '115')))).toEqual([]);
    expect(brief(checkFixture(withSlots('100', null, '80')))).toEqual(['F1 p2.r1 m3']);
  });

  it('F1: a jump against the published history', () => {
    const history: PublishedHistory = {
      items: new Map(),
      effective: new Map([['raw.steel.rebar', new Map([['2025-12', { status: 'priced' as const, price: '30000', bulletinPeriod: '2025-12' }]])]]),
      bulletins: [],
    };
    expect(brief(checkFixture(bulletin({ pages: [page({ yearly: null })] }), { history }))).toEqual(['F1 p2.r1 m1']);
  });

  it('F4: an item the published catalogue does not know', () => {
    expect(brief(checkFixture(bulletin()), { keepNewItems: true })).toEqual(['F4 p2.r1']);
  });

  it('F5: a suspended month, and a page stamp', () => {
    const file = withSlots('100', 'suspended', '100');
    expect(brief(checkFixture(file))).toEqual(['F5 p2.r1']);
    const stamped = bulletin({ pages: [page({ suspendedNoteAr: 'التسعير متوقف نظرا للظروف الاقتصادية' })] });
    expect(brief(checkFixture(stamped))).toEqual(['F5 page 2']);
  });

  it('F6: a basis other than taxes in, transport out, no minimum', () => {
    const basis = { includesTaxes: true, includesTransport: true, minimumQuantityAr: null };
    const outcome = checkFixture(bulletin({ pages: [page({ basis })] }));
    expect(brief(outcome)).toEqual(['F6 page 2']);
    expect(outcome.staged.items[0].basisNoteAr).toBe(page().basisNoteAr);
    expect(checkFixture(bulletin()).staged.items[0].basisNoteAr).toBeNull();
  });

  it('F7: rows and chart legend disagree', () => {
    expect(brief(checkFixture(bulletin({ pages: [page({ legendLabelsAr: [] })] })))).toEqual(['F7 page 2']);
  });

  it('F8: integer printing allows 1 point, one-decimal printing 0.15', () => {
    const yearly = (printed: string) => ({
      ...page().yearly!,
      printedPct: [printed, null, null, null, null, null, null, null, null, null, null, null],
    });
    const at = (printed: string) => brief(checkFixture(bulletin({ pages: [page({ yearly: yearly(printed) })] })));
    expect(at('1')).toEqual([]);
    expect(at('2')).toEqual(['F8 p2.r1 m1']);
    expect(at('0.1')).toEqual([]);
    expect(at('0.2')).toEqual(['F8 p2.r1 m1']);
  });

  it('F9: the printed average against the previous-year column', () => {
    const yearly = { ...page().yearly!, printedAverage: '38300' };
    expect(brief(checkFixture(bulletin({ pages: [page({ yearly })] })))).toEqual(['F9 p2.r1']);
  });

  it('F10: every inferred row, with its rule', () => {
    const outcome = checkFixture(bulletin({ pages: [page({ rows: [row({ confidence: 'inferred', rule: 'R6', notes: 'split' })] })] }));
    expect(brief(outcome)).toEqual(['F10 p2.r1']);
    expect(outcome.findings.find((item) => item.code === 'F10')?.message).toContain('R6: split');
  });

  it('F11: one row moves more than 5% while every sibling stays flat', () => {
    const slots = (...values: string[]) => months(...values);
    const rows = [
      row({ rowId: 'p2.r1', proposedKey: 'raw.steel.a', months: slots('100', '100'), verbatimCells: printedCells(slots('100', '100')) }),
      row({ rowId: 'p2.r2', proposedKey: 'raw.steel.b', months: slots('200', '212'), verbatimCells: printedCells(slots('200', '212')) }),
      row({ rowId: 'p2.r3', proposedKey: 'raw.steel.c', months: slots('300', '300'), verbatimCells: printedCells(slots('300', '300')) }),
    ];
    const file = bulletin({ pages: [page({ rows, legendLabelsAr: ['a', 'b', 'c'], yearly: null })] });
    expect(brief(checkFixture(file))).toEqual(['F11 p2.r2 m2']);
  });
});
