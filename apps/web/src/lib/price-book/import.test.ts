import { describe, expect, it } from 'vitest';
import {
  resolveSection,
  resolveUnit,
  validateImportRows,
  type ColumnMapping,
  type ImportSection,
} from './import';

// A mock of the 8 seeded defaults (id per key) + one create-on-use section.
const SECTIONS: ImportSection[] = [
  { id: 'sec-civil', key: 'civil', nameEn: 'Civil', nameAr: 'أعمال مدنية' },
  { id: 'sec-gypsum', key: 'gypsum', nameEn: 'Gypsum', nameAr: 'جبس' },
  { id: 'sec-electrical', key: 'electrical', nameEn: 'Electrical', nameAr: 'كهرباء' },
  { id: 'sec-finishes', key: 'finishes', nameEn: 'Finishes', nameAr: 'تشطيبات' },
  { id: 'sec-custom', key: null, nameEn: 'Landscaping', nameAr: 'تنسيق موقع' },
];

describe('resolveSection', () => {
  it('resolves by key, EN name, AR name, and retained default aliases', () => {
    expect(resolveSection('civil', SECTIONS)).toBe('sec-civil');
    expect(resolveSection('  Gypsum ', SECTIONS)).toBe('sec-gypsum');
    expect(resolveSection('أعمال مدنية', SECTIONS)).toBe('sec-civil');
    expect(resolveSection('كهرباء', SECTIONS)).toBe('sec-electrical');
    // a create-on-use section matches on its name (no key)
    expect(resolveSection('Landscaping', SECTIONS)).toBe('sec-custom');
    expect(resolveSection('تنسيق موقع', SECTIONS)).toBe('sec-custom');
    // unknown -> null (import rejects, never auto-creates)
    expect(resolveSection('nope', SECTIONS)).toBeNull();
    expect(resolveSection('', SECTIONS)).toBeNull();
  });

  // F3 — Arabic normalization (§4.1): plain-alef / haa forms resolve too.
  it('normalizes Arabic alef/taa-marbuta/maqsura and tashkeel', () => {
    expect(resolveSection('اعمال مدنية', SECTIONS)).toBe('sec-civil'); // plain alef
    expect(resolveSection('إعمال مدنيه', SECTIONS)).toBe('sec-civil'); // hamza + haa
    expect(resolveSection('أَعْمَال مَدَنِيَّة', SECTIONS)).toBe('sec-civil'); // tashkeel
    expect(resolveUnit('قطعه')).toBe('pcs'); // ة -> ه
  });
});

describe('resolveUnit', () => {
  it('resolves tokens, symbols and AR aliases', () => {
    expect(resolveUnit('sqm')).toBe('sqm');
    expect(resolveUnit('m²')).toBe('sqm');
    expect(resolveUnit('Linear Meter')).toBe('linear_meter');
    expect(resolveUnit('قطعة')).toBe('pcs');
    expect(resolveUnit('lump sum')).toBe('lump_sum');
    expect(resolveUnit('يوم')).toBe('day');
    expect(resolveUnit('parsec')).toBeNull();
  });
});

const MAP: ColumnMapping = {
  code: 0,
  nameEn: 1,
  category: 2,
  unit: 3,
  cost: 4,
  price: 5,
};

describe('validateImportRows', () => {
  it('validates a good row, resolves the section id, and normalizes money', () => {
    const rows = [['A-1', 'Paint', 'finishes', 'sqm', '1,000.50', '1500']];
    const [r] = validateImportRows(rows, MAP, new Set(), SECTIONS);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({
      code: 'A-1',
      nameEn: 'Paint',
      sectionId: 'sec-finishes',
      unit: 'sqm',
      defaultUnitCost: '1000.50',
      defaultUnitPrice: '1500',
    });
  });

  it('flags each error class, one per row, in order (unknown section -> category_invalid)', () => {
    const rows = [
      ['', '', '', '', '', ''], // 0 row_empty
      ['', 'x', 'civil', 'sqm', '1', '2'], // 1 code_missing
      ['DUP', 'x', 'civil', 'sqm', '1', '2'], // 2 ok
      ['DUP', 'x', 'civil', 'sqm', '1', '2'], // 3 code_duplicate_in_file
      ['EXIST', 'x', 'civil', 'sqm', '1', '2'], // 4 code_exists
      ['N', '', 'civil', 'sqm', '1', '2'], // 5 name_missing
      ['C', 'x', 'nope', 'sqm', '1', '2'], // 6 category_invalid (unknown section)
      ['U', 'x', 'civil', 'nope', '1', '2'], // 7 unit_invalid
      ['CO', 'x', 'civil', 'sqm', 'abc', '2'], // 8 cost_invalid
      ['PR', 'x', 'civil', 'sqm', '1', 'xyz'], // 9 price_invalid
    ];
    const out = validateImportRows(rows, MAP, new Set(['EXIST']), SECTIONS);
    expect(out.map((r) => (r.ok ? 'ok' : r.error))).toEqual([
      'row_empty',
      'code_missing',
      'ok',
      'code_duplicate_in_file',
      'code_exists',
      'name_missing',
      'category_invalid',
      'unit_invalid',
      'cost_invalid',
      'price_invalid',
    ]);
  });

  // F4 — code matching is case-SENSITIVE (matches the DB unique(org_id, code)).
  it('treats codes as case-sensitive (ABC vs abc are distinct)', () => {
    const existRow = [['abc', 'x', 'civil', 'sqm', '1', '2']];
    expect(
      validateImportRows(existRow, MAP, new Set(['ABC']), SECTIONS)[0].ok,
    ).toBe(true);

    const dupRows = [
      ['abc', 'x', 'civil', 'sqm', '1', '2'],
      ['ABC', 'x', 'civil', 'sqm', '1', '2'],
    ];
    const out = validateImportRows(dupRows, MAP, new Set(), SECTIONS);
    expect(out[0].ok).toBe(true);
    expect(out[1].ok).toBe(true); // not a duplicate — different case
  });

  it('treats an empty money cell as 0', () => {
    const rows = [['Z', 'x', 'civil', 'sqm', '', '']];
    const [r] = validateImportRows(rows, MAP, new Set(), SECTIONS);
    expect(r.ok).toBe(true);
    expect(r.data?.defaultUnitCost).toBe('0');
    expect(r.data?.defaultUnitPrice).toBe('0');
  });

  // F1 — strict money parser.
  it('accepts plain and comma-grouped decimals; rejects ambiguous separators', () => {
    const money = (raw: string) =>
      validateImportRows(
        [['K', 'x', 'civil', 'sqm', raw, '1']],
        MAP,
        new Set(),
        SECTIONS,
      )[0];

    // valid
    expect(money('1234.56').data?.defaultUnitCost).toBe('1234.56');
    expect(money('1,234.56').data?.defaultUnitCost).toBe('1234.56');
    expect(money('1,000,000').data?.defaultUnitCost).toBe('1000000');
    expect(money('0').ok).toBe(true);

    // invalid -> cost_invalid (whole file never rejected)
    for (const bad of [
      '1,5',
      '1.234,56',
      '1,2,3',
      '-5',
      '.5',
      '1.',
      '1e3',
      'Infinity',
      'NaN',
      '$5',
      '١٢٣', // Arabic-Indic digits
      '12,34',
    ]) {
      expect(money(bad).error, `"${bad}" should be cost_invalid`).toBe(
        'cost_invalid',
      );
    }
  });
});
