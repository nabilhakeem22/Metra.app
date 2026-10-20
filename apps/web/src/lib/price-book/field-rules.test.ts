import { describe, expect, test } from 'vitest';
import { costItemFieldErrors, readCostItemInput } from './field-rules';
import type { CostItemInput } from './fields';

const VALID: CostItemInput = {
  code: ' PB-1 ',
  nameEn: 'Board',
  nameAr: null,
  sectionId: 's-1',
  unit: 'sqm',
  defaultUnitCost: '1,500',
  defaultUnitPrice: '',
};

describe('readCostItemInput', () => {
  test('reads trimmed text, grouped thousands, and a cleared box as zero', () => {
    expect(readCostItemInput(VALID)).toEqual({
      ok: true,
      values: {
        code: 'PB-1',
        nameEn: 'Board',
        nameAr: null,
        defaultUnitCost: '1500',
        defaultUnitPrice: '0',
      },
    });
  });

  test('says every broken rule at once, each under its own field', () => {
    expect(
      costItemFieldErrors({
        ...VALID,
        code: '  ',
        nameEn: ' ',
        defaultUnitCost: '1,5',
        defaultUnitPrice: '9999999999999',
      }),
    ).toEqual({
      code: { code: 'code_required' },
      name: { code: 'name_required' },
      defaultUnitCost: { code: 'not_a_number' },
      defaultUnitPrice: { code: 'amount_too_large' },
    });
  });

  test('a negative figure is said as below zero, not as not-a-number', () => {
    expect(costItemFieldErrors({ ...VALID, defaultUnitCost: '-5' })).toEqual({
      defaultUnitCost: { code: 'not_negative' },
    });
  });

  test('one name of the pair is enough', () => {
    expect(costItemFieldErrors({ ...VALID, nameEn: null, nameAr: 'لوح' })).toEqual({});
  });

  test('a name that is only too long or unprintable is said under its own half, not as missing', () => {
    expect(costItemFieldErrors({ ...VALID, nameEn: 'B'.repeat(1001) })).toEqual({ nameEn: { code: 'too_long', params: { max: 1000 } } });
    expect(costItemFieldErrors({ ...VALID, nameEn: null, nameAr: `لوح${String.fromCharCode(7)}` })).toEqual({ nameAr: { code: 'unprintable' } });
  });

  test('an edit keeps an unchanged long code and name, and refuses a changed one (N1)', () => {
    const stored = { code: 'C'.repeat(214), nameEn: 'B'.repeat(1290), nameAr: null };
    expect(costItemFieldErrors({ ...VALID, ...stored, defaultUnitPrice: '150' }, stored)).toEqual({});
    expect(costItemFieldErrors({ ...VALID, ...stored, nameEn: `${stored.nameEn}x` }, stored)).toEqual({ nameEn: { code: 'too_long', params: { max: 1000 } } });
    expect(costItemFieldErrors({ ...VALID, ...stored })).toMatchObject({ code: { code: 'too_long' }, nameEn: { code: 'too_long' } });
  });
});
