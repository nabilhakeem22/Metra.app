import { describe, expect, it } from 'vitest';
import { pageCountOf, pagerSlots, type PagerSlot } from './table-pager-window';

/** The slots as the pager draws them: page numbers, and … for a gap. */
const drawn = (slots: PagerSlot[]) => slots.map((slot) => (slot.kind === 'page' ? String(slot.page) : '…')).join(' ');

describe('pageCountOf', () => {
  it('fills whole pages and rounds a part page up', () => {
    expect(pageCountOf(340, 25)).toBe(14);
    expect(pageCountOf(50, 25)).toBe(2);
    expect(pageCountOf(51, 25)).toBe(3);
    expect(pageCountOf(1, 25)).toBe(1);
  });

  it('is one page when there is nothing to page through', () => {
    expect(pageCountOf(0, 25)).toBe(1);
    expect(pageCountOf(-5, 25)).toBe(1);
    expect(pageCountOf(Number.NaN, 25)).toBe(1);
    expect(pageCountOf(10, 0)).toBe(1);
  });
});

describe('pagerSlots', () => {
  it('shows the first, the last, and the current page with its neighbours, gaps between', () => {
    expect(drawn(pagerSlots(5, 12))).toBe('1 … 4 5 6 … 12');
  });

  it('on the first page', () => {
    expect(drawn(pagerSlots(1, 12))).toBe('1 2 … 12');
  });

  it('on the last page', () => {
    expect(drawn(pagerSlots(12, 12))).toBe('1 … 11 12');
  });

  it('near either end, without a gap that hides nothing', () => {
    expect(drawn(pagerSlots(2, 12))).toBe('1 2 3 … 12');
    expect(drawn(pagerSlots(11, 12))).toBe('1 … 10 11 12');
  });

  it('shows a lone hidden page instead of a gap for it', () => {
    expect(drawn(pagerSlots(4, 12))).toBe('1 2 3 4 5 … 12');
    expect(drawn(pagerSlots(9, 12))).toBe('1 … 8 9 10 11 12');
  });

  it('small counts show every page', () => {
    expect(drawn(pagerSlots(1, 1))).toBe('1');
    expect(drawn(pagerSlots(1, 2))).toBe('1 2');
    expect(drawn(pagerSlots(2, 3))).toBe('1 2 3');
    expect(drawn(pagerSlots(3, 5))).toBe('1 2 3 4 5');
  });

  it('reads a page outside the range as the nearest end', () => {
    expect(drawn(pagerSlots(0, 12))).toBe(drawn(pagerSlots(1, 12)));
    expect(drawn(pagerSlots(99, 12))).toBe(drawn(pagerSlots(12, 12)));
    expect(drawn(pagerSlots(3, 0))).toBe('1');
  });

  it('gives each gap a key of its own', () => {
    const gaps = pagerSlots(6, 12).filter((slot) => slot.kind === 'gap');
    expect(gaps).toEqual([{ kind: 'gap', after: 1 }, { kind: 'gap', after: 7 }]);
  });
});
