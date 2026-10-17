import { describe, expect, it } from 'vitest';
import { planSeed, type MarketSeedItem, type StudioBook } from './plan';

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

const EMPTY: StudioBook = { sections: [], items: [] };

describe('planSeed', () => {
  it('creates the item in a new section named after its sub-category, priced at cost x 1.05', () => {
    const plan = planSeed([item()], EMPTY);
    expect(plan.sectionsToCreate).toEqual([{ key: 'market.finishing.glass', nameAr: 'الزجاج', nameEn: 'Glass', qualified: false }]);
    expect(plan.itemsToCreate).toEqual([{
      marketItemId: 'm-glass', sectionKey: 'market.finishing.glass', code: 'MKT-finishing.glass.clear_4mm',
      nameAr: 'زجاج شفاف 4 مم', nameEn: 'Clear glass 4 mm', unit: 'sqm', defaultUnitCost: '467.0000', defaultUnitPrice: '490.3500',
    }]);
  });

  it('names a roll with its pack size and maps it to the studio roll', () => {
    const roll = item({ id: 'm-wire', key: 'electrical.wires.copper_2mm', nameAr: 'أسلاك نحاس معزول', nameEn: 'Insulated copper wire', specAr: '2 مم', specEn: '2 mm', unit: 'roll', pack: { lengthM: 100, pieces: null, pieceLengthM: null }, leafKey: 'electrical.wires' });
    expect(planSeed([roll], EMPTY).itemsToCreate[0]).toMatchObject({ nameAr: 'أسلاك نحاس معزول 2 مم لفة 100 م', nameEn: 'Insulated copper wire 2 mm roll of 100 m', unit: 'roll' });
    const bundle = item({ unit: 'roll', pack: { lengthM: null, pieces: 34, pieceLengthM: 3 }, specAr: null, specEn: null });
    expect(planSeed([bundle], EMPTY).itemsToCreate[0]).toMatchObject({ nameAr: 'زجاج شفاف لفة 34×3 م', nameEn: 'Clear glass roll of 34 x 3 m' });
  });

  it('skips with one reason each, in order, and creates no section for a skipped item', () => {
    const items = [
      item({ id: 'linked' }),
      item({ id: 'old', key: 'k.k.old', status: 'discontinued' }),
      item({ id: 'bag', key: 'raw.cement.bag', unit: 'bag' }),
      item({ id: 'pack', key: 'raw.joint_fillers.pack', unit: 'pack' }),
      item({ id: 'bricks', key: 'raw.bricks.red', unit: 'thousand_bricks' }),
      item({ id: 'none', key: 'roads.bearings_joints.b', latestPrice: null }),
      item({ id: 'code', key: 'finishing.glass.taken' }),
      item({ id: 'name', key: 'finishing.glass.clear_6mm', specAr: '6 مم', specEn: '6 mm' }),
    ];
    const book: StudioBook = {
      sections: [],
      items: [
        { code: 'OWN-1', nameAr: 'بند الاستوديو', nameEn: null, marketItemId: 'linked' },
        { code: 'MKT-finishing.glass.taken', nameAr: 'شيء اخر', nameEn: 'Other', marketItemId: null },
        { code: 'OWN-2', nameAr: null, nameEn: 'CLEAR GLASS 6 MM', marketItemId: null },
      ],
    };
    const plan = planSeed(items, book);
    expect(plan.skipped).toEqual({ already_linked: 1, discontinued: 1, unit_unsupported: 3, no_price: 1, code_clash: 1, name_clash: 1 });
    expect(plan.itemsToCreate).toEqual([]);
    expect(plan.sectionsToCreate).toEqual([]);
  });

  it('matches a name clash in Arabic after normalisation', () => {
    const book: StudioBook = { sections: [], items: [{ code: 'OWN', nameAr: 'زجاج  شفاف 4 مم', nameEn: null, marketItemId: null }] };
    expect(planSeed([item()], book).skipped.name_clash).toBe(1);
  });

  it('qualifies a section name the studio already uses, and reuses a section the seed made before', () => {
    const clash: StudioBook = { sections: [{ id: 's1', key: null, nameAr: null, nameEn: 'glass' }], items: [] };
    expect(planSeed([item()], clash).sectionsToCreate).toEqual([
      { key: 'market.finishing.glass', nameAr: 'الزجاج (خامات التشطيب)', nameEn: 'Glass (Finishing materials)', qualified: true },
    ]);
    const seeded: StudioBook = { sections: [{ id: 's2', key: 'market.finishing.glass', nameAr: 'الزجاج', nameEn: 'Glass' }], items: [] };
    const plan = planSeed([item()], seeded);
    expect(plan.sectionsToCreate).toEqual([]);
    expect(plan.sectionsPresent).toBe(1);
    expect(plan.itemsToCreate).toHaveLength(1);
  });

  it('plans nothing on a second run (every item already linked)', () => {
    const first = planSeed([item()], EMPTY);
    const after: StudioBook = {
      sections: [{ id: 's', key: 'market.finishing.glass', nameAr: 'الزجاج', nameEn: 'Glass' }],
      items: first.itemsToCreate.map((created) => ({ code: created.code, nameAr: created.nameAr, nameEn: created.nameEn, marketItemId: created.marketItemId })),
    };
    const second = planSeed([item()], after);
    expect(second.itemsToCreate).toEqual([]);
    expect(second.sectionsToCreate).toEqual([]);
    expect(second.skipped.already_linked).toBe(1);
  });
});
