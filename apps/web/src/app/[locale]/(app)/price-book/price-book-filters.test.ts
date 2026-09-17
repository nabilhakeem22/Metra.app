import { describe, expect, test } from 'vitest';
import {
  filterCostItems,
  groupBySection,
  type PriceBookFilter,
} from './price-book-filters';
import type { PriceBookItem, SectionOption } from './types';

function item(overrides: Partial<PriceBookItem> = {}): PriceBookItem {
  return {
    id: 'i-1',
    code: 'GYP-001',
    nameEn: 'Gypsum board',
    nameAr: 'جبسوم بورد',
    sectionId: 'sec-ceilings',
    unit: 'sqm',
    defaultUnitCost: '120.0000',
    defaultUnitPrice: '200.0000',
    taxCode: null,
    etaItemCode: null,
    etaCodeType: null,
    active: true,
    ...overrides,
  } as PriceBookItem;
}

function section(id: string, nameEn: string): SectionOption {
  return { id, key: null, nameEn, nameAr: null };
}

const ALL: PriceBookFilter = { query: '', sectionId: 'all', activeOnly: false };
const ids = (rows: PriceBookItem[]) => rows.map((row) => row.id);

describe('filterCostItems', () => {
  const items = [
    item({ id: 'a', code: 'GYP-001', sectionId: 'sec-ceilings', active: true }),
    item({
      id: 'b',
      code: 'PNT-002',
      nameEn: 'Emulsion paint',
      nameAr: 'دهان بلاستيك',
      sectionId: 'sec-finishes',
    }),
    item({ id: 'c', code: 'GYP-009', sectionId: 'sec-ceilings', active: false }),
  ];

  test('the resting filter returns everything, in order', () => {
    expect(ids(filterCostItems(items, ALL))).toEqual(['a', 'b', 'c']);
  });

  test('a section id narrows to that section', () => {
    expect(ids(filterCostItems(items, { ...ALL, sectionId: 'sec-ceilings' }))).toEqual([
      'a',
      'c',
    ]);
  });

  // Off by default: the book is a CATALOGUE, not a list of what is on offer now.
  test('activeOnly hides retired items, and is off by default', () => {
    expect(ids(filterCostItems(items, ALL))).toContain('c');
    expect(ids(filterCostItems(items, { ...ALL, activeOnly: true }))).toEqual(['a', 'b']);
  });

  test('the search matches the CODE', () => {
    expect(ids(filterCostItems(items, { ...ALL, query: 'gyp-00' }))).toEqual(['a', 'c']);
  });

  test('the search matches the English name and the Arabic name', () => {
    expect(ids(filterCostItems(items, { ...ALL, query: 'emulsion' }))).toEqual(['b']);
    expect(ids(filterCostItems(items, { ...ALL, query: 'جبسوم' }))).toEqual(['a', 'c']);
  });

  test('a null name does not match the word null', () => {
    const nameless = [item({ id: 'n', nameEn: null, nameAr: null, code: 'X-1' })];
    expect(filterCostItems(nameless, { ...ALL, query: 'null' })).toEqual([]);
  });

  test('a whitespace-only query is not a filter', () => {
    expect(ids(filterCostItems(items, { ...ALL, query: '  ' }))).toEqual(['a', 'b', 'c']);
  });

  test('the three filters COMPOSE', () => {
    const filter: PriceBookFilter = {
      query: 'gyp',
      sectionId: 'sec-ceilings',
      activeOnly: true,
    };
    expect(ids(filterCostItems(items, filter))).toEqual(['a']);
  });
});

describe('groupBySection', () => {
  const sections = [
    section('sec-ceilings', 'Ceilings'),
    section('sec-finishes', 'Finishes'),
    section('sec-empty', 'Joinery'),
  ];

  test('groups in the SECTIONS own order, not the items order', () => {
    const items = [
      item({ id: 'paint', sectionId: 'sec-finishes' }),
      item({ id: 'gypsum', sectionId: 'sec-ceilings' }),
    ];
    expect(groupBySection(items, sections).map((group) => group.section.id)).toEqual([
      'sec-ceilings',
      'sec-finishes',
    ]);
  });

  // A filtered book that still lists twelve empty section headings reads as
  // "nothing matched" twelve times over.
  test('a section with no visible rows is DROPPED', () => {
    const groups = groupBySection([item({ sectionId: 'sec-ceilings' })], sections);
    expect(groups.map((group) => group.section.id)).toEqual(['sec-ceilings']);
  });

  test('an item whose section is unknown is not rendered at all', () => {
    expect(groupBySection([item({ sectionId: 'sec-ghost' })], sections)).toEqual([]);
  });

  test('no items at all is no groups', () => {
    expect(groupBySection([], sections)).toEqual([]);
  });

  test('each group carries its own rows and nobody else s', () => {
    const items = [
      item({ id: 'a', sectionId: 'sec-ceilings' }),
      item({ id: 'b', sectionId: 'sec-ceilings' }),
      item({ id: 'c', sectionId: 'sec-finishes' }),
    ];
    const groups = groupBySection(items, sections);
    expect(ids(groups[0]?.rows ?? [])).toEqual(['a', 'b']);
    expect(ids(groups[1]?.rows ?? [])).toEqual(['c']);
  });
});
