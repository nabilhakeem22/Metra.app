import { describe, expect, it } from 'vitest';
import { planSeed } from './plan';
import type { MarketSeedItem, StudioBook } from './types';

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
      marketItemId: 'm-glass', section: { key: 'market.finishing.glass' }, code: 'MKT-finishing.glass.clear_4mm',
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

  const RLM = String.fromCharCode(0x200f);
  const ALM = String.fromCharCode(0x061c);
  const ZWNJ = String.fromCharCode(0x200c);
  const NBSP = String.fromCharCode(0xa0);
  const PERSIAN_YEH = String.fromCharCode(0x06cc);
  const tempered = item({ nameAr: 'زجاج سيكوريت', specAr: '6 مم', nameEn: 'Tempered glass', specEn: '6 mm' });
  it.each([
    ['an RLM', `زجاج سيكوريت${RLM} 6 مم`, null],
    ['a Persian yeh', `زجاج س${PERSIAN_YEH}كور${PERSIAN_YEH}ت 6 مم`, null],
    ['an ALM and a ZWNJ', `زجاج${ALM} سيكوريت 6${ZWNJ} مم`, null],
    ['an inner double space', null, 'Tempered  glass 6 mm'],
    ['an NBSP', null, `Tempered glass${NBSP}6 mm`],
    ['other letter case', null, 'TEMPERED GLASS 6 MM'],
  ])('sees a studio name with %s as the same name (F2)', (_label, nameAr, nameEn) => {
    const book: StudioBook = { sections: [], items: [{ code: 'OWN', nameAr, nameEn, marketItemId: null }] };
    expect(planSeed([tempered], book).skipped.name_clash).toBe(1);
  });

  it('puts the items in a studio section that already has the qualified name, instead of a duplicate (F2)', () => {
    const book: StudioBook = { sections: [{ id: 'mine', key: null, nameAr: null, nameEn: 'glass ' }, { id: 'theirs', key: null, nameAr: null, nameEn: 'Glass  (Finishing materials)' }], items: [] };
    const plan = planSeed([item()], book);
    expect(plan.sectionsToCreate).toEqual([]);
    expect(plan.itemsToCreate[0].section).toEqual({ id: 'theirs' });
    expect(plan.sectionsPresent).toBe(1);
  });

  it('never counts its own seeded items as a name clash, so a partial undo re-seeds (F3)', () => {
    const twin = item({ id: 'standard', key: 'pipes.drainage_clay_standard.elbow_150', nameAr: 'كوع فخار', specAr: '150 مم', nameEn: 'Clay elbow', specEn: '150 mm', unit: 'pcs', leafKey: 'pipes.drainage_clay_standard', leafNameAr: 'مواسير صرف فخار عادية', leafNameEn: 'Standard clay drainage pipes' });
    const flexible = { ...twin, id: 'flexible', key: 'pipes.drainage_clay_flexible.elbow_150', leafKey: 'pipes.drainage_clay_flexible', leafNameAr: 'مواسير صرف فخار بوصلات مرنة', leafNameEn: 'Flexible-joint clay drainage pipes' };
    const first = planSeed([twin, flexible], EMPTY);
    const kept = first.itemsToCreate.find((created) => created.marketItemId === 'standard')!;
    const afterUndo: StudioBook = { sections: [], items: [{ code: kept.code, nameAr: kept.nameAr, nameEn: kept.nameEn, marketItemId: 'standard' }] };
    expect(planSeed([twin, flexible], afterUndo).itemsToCreate.map((created) => created.marketItemId)).toEqual(['flexible']);
  });

  it('gives two items that would read alike their sub-category, in both languages (F3)', () => {
    const twin = item({ id: 'standard', key: 'pipes.drainage_clay_standard.elbow_150', nameAr: 'كوع فخار', specAr: '150 مم', nameEn: 'Clay elbow', specEn: '150 mm', unit: 'pcs', leafKey: 'pipes.drainage_clay_standard', leafNameAr: 'مواسير صرف فخار عادية', leafNameEn: 'Standard clay drainage pipes' });
    const flexible = { ...twin, id: 'flexible', key: 'pipes.drainage_clay_flexible.elbow_150', leafKey: 'pipes.drainage_clay_flexible', leafNameAr: 'مواسير صرف فخار بوصلات مرنة', leafNameEn: 'Flexible-joint clay drainage pipes' };
    const names = planSeed([twin, flexible, item()], EMPTY).itemsToCreate.map(({ nameAr, nameEn }) => [nameAr, nameEn]);
    expect(names).toEqual([
      ['كوع فخار 150 مم (مواسير صرف فخار عادية)', 'Clay elbow 150 mm (Standard clay drainage pipes)'],
      ['كوع فخار 150 مم (مواسير صرف فخار بوصلات مرنة)', 'Clay elbow 150 mm (Flexible-joint clay drainage pipes)'],
      ['زجاج شفاف 4 مم', 'Clear glass 4 mm'],
    ]);
  });
});

describe('seeded names', () => {
  it('do not repeat the roll in English, nor a spec part the name already has (F7)', () => {
    const hose = item({ nameEn: 'Polyethylene conduit hose', specEn: '13 mm, 30 m roll', nameAr: 'خراطيم', specAr: '13 مم', unit: 'roll', pack: { lengthM: 30, pieces: null, pieceLengthM: null } });
    expect(planSeed([hose], EMPTY).itemsToCreate[0]).toMatchObject({ nameEn: 'Polyethylene conduit hose 13 mm, 30 m roll', nameAr: 'خراطيم 13 مم لفة 30 م' });
    const upvc = item({ nameEn: 'White UPVC conduit, light gauge', specEn: '20 mm OD, 17.4 mm ID, light gauge', unit: 'roll', pack: { lengthM: null, pieces: 34, pieceLengthM: 3 } });
    expect(planSeed([upvc], EMPTY).itemsToCreate[0].nameEn).toBe('White UPVC conduit, light gauge 20 mm OD, 17.4 mm ID roll of 34 x 3 m');
  });

  it('turn an Arabic " - " separator into a comma and keep a range hyphen (no-dash rule)', () => {
    const ppr = item({ nameAr: 'مواسير بولي بروبلين', specAr: '1/2" - 20 مم سمك 3.4 مم' });
    const boards = item({ id: 'b', key: 'k.k.b', nameAr: 'ألواح مارموكس', specAr: 'سمك 4مم-6مم' });
    expect(planSeed([ppr, boards], EMPTY).itemsToCreate.map((created) => created.nameAr)).toEqual([
      'مواسير بولي بروبلين 1/2"، 20 مم سمك 3.4 مم',
      'ألواح مارموكس سمك 4مم-6مم',
    ]);
  });
});

describe('a studio item typed as the bulletin prints it (R1)', () => {
  const own = (nameAr: string): StudioBook => ({ sections: [], items: [{ code: 'OWN', nameAr, nameEn: null, marketItemId: null }] });

  it('clashes with the spaced hyphen the seed rewrites', () => {
    const board = item({ nameAr: 'بلاطات جبسية', specAr: '60*60 - 9.5 ملى (جيبورد)', nameEn: 'Gypsum ceiling tile', specEn: '60x60, 9.5 mm' });
    expect(planSeed([board], own('بلاطات جبسية 60*60 - 9.5 ملى (جيبورد)')).skipped.name_clash).toBe(1);
    const ppr = item({ nameAr: 'مواسير بولي بروبلين أخضر عادي 20 بار', specAr: '1/2" - 20 مم سمك 3.4 مم', nameEn: 'PPR pipe', specEn: '1/2 in' });
    expect(planSeed([ppr], own('مواسير بولي بروبلين أخضر عادي 20 بار 1/2" - 20 مم سمك 3.4 مم')).skipped.name_clash).toBe(1);
  });

  it('clashes with both clay twins when the studio has the bare printed name', () => {
    const twin = item({ id: 'standard', key: 'pipes.drainage_clay_standard.bend_150mm', nameAr: 'كوع فخار', specAr: '150 مم', nameEn: 'Clay bend', specEn: '150 mm', unit: 'pcs', leafKey: 'pipes.drainage_clay_standard', leafNameAr: 'مواسير صرف فخار عادية', leafNameEn: 'Standard clay drainage pipes' });
    const flexible = { ...twin, id: 'flexible', key: 'pipes.drainage_clay_flexible.bend_150mm', nameEn: 'Clay bend, flexible joint', leafKey: 'pipes.drainage_clay_flexible', leafNameAr: 'مواسير صرف فخار بوصلات مرنة', leafNameEn: 'Flexible-joint clay drainage pipes' };
    const plan = planSeed([twin, flexible], own('كوع فخار 150 مم'));
    expect(plan.skipped.name_clash).toBe(2);
    expect(plan.itemsToCreate).toEqual([]);
  });

  it('still clashes with the seeded spelling, and a roll typed without its pack', () => {
    const board = item({ nameAr: 'بلاطات جبسية', specAr: '60*60 - 9.5 ملى', nameEn: 'Board', specEn: null });
    expect(planSeed([board], own('بلاطات جبسية 60*60، 9.5 ملى')).skipped.name_clash).toBe(1);
    const wire = item({ nameAr: 'أسلاك نحاس معزول', specAr: '2 مم', unit: 'roll', pack: { lengthM: 100, pieces: null, pieceLengthM: null } });
    expect(planSeed([wire], own('أسلاك نحاس معزول 2 مم')).skipped.name_clash).toBe(1);
  });
});

