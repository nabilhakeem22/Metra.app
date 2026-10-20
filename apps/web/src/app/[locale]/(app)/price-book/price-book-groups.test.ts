import { describe, expect, test } from 'vitest';
import { groupPageRows } from './price-book-groups';
import type { PriceBookItem, SectionOption } from './types';

function item(id: string, sectionId: string): PriceBookItem {
  return {
    id,
    code: `C-${id}`,
    nameEn: `Item ${id}`,
    nameAr: null,
    sectionId,
    unit: 'sqm',
    defaultUnitCost: '1.0000',
    defaultUnitPrice: '2.0000',
    taxCode: null,
    etaItemCode: null,
    etaCodeType: null,
    active: true,
    marketItemId: null,
  };
}

const SECTIONS: SectionOption[] = [
  { id: 'ceilings', key: null, nameEn: 'Ceilings', nameAr: null },
  { id: 'finishes', key: null, nameEn: 'Finishes', nameAr: null },
];
const ids = (rows: PriceBookItem[]) => rows.map((row) => row.id);

describe('groupPageRows', () => {
  test('keeps the order the database gave, one heading per run of a section', () => {
    const groups = groupPageRows([item('a', 'finishes'), item('b', 'finishes'), item('c', 'ceilings')], SECTIONS, {});
    expect(groups.map((group) => group.section.id)).toEqual(['finishes', 'ceilings']);
    expect(ids(groups[0].rows)).toEqual(['a', 'b']);
    expect(ids(groups[1].rows)).toEqual(['c']);
  });

  test('a section carries its count over every page, not this page only', () => {
    const [group] = groupPageRows([item('a', 'ceilings')], SECTIONS, { ceilings: 120 });
    expect(group.matched).toBe(120);
  });

  test('a row whose section is unknown is not rendered at all', () => {
    expect(groupPageRows([item('a', 'ghost')], SECTIONS, { ghost: 1 })).toEqual([]);
  });

  test('no rows is no groups', () => {
    expect(groupPageRows([], SECTIONS, {})).toEqual([]);
  });
});
