import { describe, expect, it } from 'vitest';
import {
  resolveCategory,
  resolveUnit,
  validateImportRows,
  type ColumnMapping,
} from './import';

describe('resolveCategory', () => {
  it('resolves tokens, EN and AR aliases; rejects unknown', () => {
    expect(resolveCategory('civil')).toBe('civil');
    expect(resolveCategory('  Gypsum ')).toBe('gypsum');
    expect(resolveCategory('أعمال مدنية')).toBe('civil');
    expect(resolveCategory('كهرباء')).toBe('electrical');
    expect(resolveCategory('nope')).toBeNull();
    expect(resolveCategory('')).toBeNull();
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
  it('validates a good row and normalizes money', () => {
    const rows = [['A-1', 'Paint', 'finishes', 'sqm', '1,000.50', '1500']];
    const [r] = validateImportRows(rows, MAP, new Set());
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({
      code: 'A-1',
      nameEn: 'Paint',
      category: 'finishes',
      unit: 'sqm',
      defaultUnitCost: '1000.50',
      defaultUnitPrice: '1500',
    });
  });

  it('flags each error class, one per row, in order', () => {
    const rows = [
      ['', '', '', '', '', ''], // 0 row_empty
      ['', 'x', 'civil', 'sqm', '1', '2'], // 1 code_missing
      ['DUP', 'x', 'civil', 'sqm', '1', '2'], // 2 ok
      ['DUP', 'x', 'civil', 'sqm', '1', '2'], // 3 code_duplicate_in_file
      ['EXIST', 'x', 'civil', 'sqm', '1', '2'], // 4 code_exists
      ['N', '', 'civil', 'sqm', '1', '2'], // 5 name_missing
      ['C', 'x', 'nope', 'sqm', '1', '2'], // 6 category_invalid
      ['U', 'x', 'civil', 'nope', '1', '2'], // 7 unit_invalid
      ['CO', 'x', 'civil', 'sqm', 'abc', '2'], // 8 cost_invalid
      ['PR', 'x', 'civil', 'sqm', '1', 'xyz'], // 9 price_invalid
    ];
    const out = validateImportRows(rows, MAP, new Set(['exist']));
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

  it('code_exists is case-insensitive', () => {
    const rows = [['abc', 'x', 'civil', 'sqm', '1', '2']];
    const [r] = validateImportRows(rows, MAP, new Set(['ABC'.toLowerCase()]));
    expect(r.error).toBe('code_exists');
  });

  it('treats an empty money cell as 0', () => {
    const rows = [['Z', 'x', 'civil', 'sqm', '', '']];
    const [r] = validateImportRows(rows, MAP, new Set());
    expect(r.ok).toBe(true);
    expect(r.data?.defaultUnitCost).toBe('0');
    expect(r.data?.defaultUnitPrice).toBe('0');
  });
});
