import { describe, expect, it } from 'vitest';
import { buildSeedBook } from './book';
import { comparisonForm } from './compare';
import { canClashByName, planSeed } from './plan';
import type { MarketSeedItem } from './types';

function item(overrides: Partial<MarketSeedItem> = {}): MarketSeedItem {
  return {
    id: 'm-glass',
    key: 'finishing.glass.clear_4mm',
    nameAr: 'زجاج شفاف',
    nameEn: 'Clear glass',
    specAr: '4 مم',
    specEn: '4 mm',
    unit: 'sqm',
    pack: null,
    status: 'active',
    leafKey: 'finishing.glass',
    leafNameAr: 'الزجاج',
    leafNameEn: 'Glass',
    topNameAr: 'خامات التشطيب',
    topNameEn: 'Finishing materials',
    latestPrice: '467',
    ...overrides,
  };
}

describe('buildSeedBook', () => {
  it('decides code, names, studio unit, cost and cost x 1.05 once, in the published order', () => {
    const book = buildSeedBook([item(), item({ id: 'm-bag', key: 'raw.cement.bag', nameAr: 'أسمنت', nameEn: 'Cement', unit: 'bag', latestPrice: null, status: 'discontinued' })]);
    expect(book.map((entry) => entry.marketItemId)).toEqual(['m-glass', 'm-bag']);
    expect(book[0]).toMatchObject({
      code: 'MKT-finishing.glass.clear_4mm', nameAr: 'زجاج شفاف 4 مم', nameEn: 'Clear glass 4 mm',
      unit: 'sqm', unitCost: '467.0000', unitPrice: '490.3500', status: 'active', leafKey: 'finishing.glass', topNameEn: 'Finishing materials',
    });
    expect(book[1]).toMatchObject({ unit: null, unitCost: null, unitPrice: null, status: 'discontinued' });
  });

  it('keeps every spelling a studio item clashes with, folded, without blanks or repeats', () => {
    const [entry] = buildSeedBook([item({ specAr: '60*60 - 9.5 ملى', specEn: null, nameEn: 'Board' })]);
    expect(entry.nameForms).toEqual([...new Set(entry.nameForms)]);
    expect(entry.nameForms).not.toContain('');
    for (const typed of ['زجاج شفاف 60*60، 9.5 ملى', 'زجاج شفاف 60*60 - 9.5 ملى', 'BOARD']) {
      expect(entry.nameForms).toContain(comparisonForm(typed));
    }
  });

  it('is built from the WHOLE set: two items that read alike both carry their sub-category', () => {
    const twin = item({ id: 'a', key: 'pipes.clay_a.elbow', nameAr: 'كوع', specAr: null, nameEn: 'Elbow', specEn: null, leafKey: 'pipes.clay_a', leafNameAr: 'أ', leafNameEn: 'A' });
    const book = buildSeedBook([twin, { ...twin, id: 'b', key: 'pipes.clay_b.elbow', leafKey: 'pipes.clay_b', leafNameAr: 'ب', leafNameEn: 'B' }]);
    expect(book.map((entry) => entry.nameEn)).toEqual(['Elbow (A)', 'Elbow (B)']);
  });
});

describe('canClashByName', () => {
  it('is false for a studio with no item of its own, so its plan never reads a name form', () => {
    expect(canClashByName({ sections: [], items: [] })).toBe(false);
    expect(canClashByName({ sections: [], items: [{ code: 'MKT-x', nameAr: 'زجاج', nameEn: null, marketItemId: null }] })).toBe(false);
    expect(canClashByName({ sections: [], items: [{ code: 'OWN', nameAr: 'زجاج', nameEn: null, marketItemId: 'm' }] })).toBe(false);
    expect(canClashByName({ sections: [], items: [{ code: 'OWN', nameAr: 'زجاج', nameEn: null, marketItemId: null }] })).toBe(true);
  });

  it('agrees with the plan: without its own items, emptied name forms plan the same', () => {
    const studio = { sections: [], items: [{ code: 'MKT-other', nameAr: 'زجاج شفاف 4 مم', nameEn: null, marketItemId: null }] };
    const book = buildSeedBook([item()]);
    expect(planSeed(book.map((entry) => ({ ...entry, nameForms: [] })), studio)).toEqual(planSeed(book, studio));
  });
});
