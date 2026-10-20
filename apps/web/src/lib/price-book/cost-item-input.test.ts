import { describe, expect, test } from 'vitest';
import { readAddMarketItemInput } from '@/lib/market-book/add-input';
import { COST_ITEM_CODE_MAX, COST_ITEM_NAME_MAX, hasCostItemInputShape, readCostItemCode, readCostItemName } from './cost-item-input';
import { costItemFieldErrors } from './field-rules';

const NUL = String.fromCharCode(0);

describe('hasCostItemInputShape (S2: a hand-made server-action call is malformed, never a throw)', () => {
  const add = { marketItemId: 'm', code: 'C', sectionId: 's' };

  test.each<[string, unknown]>([
    ['a code that is a number', { ...add, code: 123 }],
    ['a name that is an object', { ...add, nameEn: { a: 1 } }],
    ['no input at all', null],
    ['an array', [add]],
    ['a price that is a number', { ...add, defaultUnitPrice: 5 }],
    ['the writer\'s own field not text', { ...add, marketItemId: 7 }],
  ])('refuses %s', (_, input) => {
    expect(hasCostItemInputShape(input, ['marketItemId'])).toBe(false);
  });

  test('takes strings, nulls and absent fields, and ignores fields it does not read', () => {
    expect(hasCostItemInputShape({ ...add, nameAr: null, orgId: 9 }, ['marketItemId'])).toBe(true);
    expect(hasCostItemInputShape({ code: 'C', sectionId: 's', unit: 'sqm', defaultUnitCost: 1 }, ['unit', 'defaultUnitCost'])).toBe(false);
  });
});

describe('the code and name rules every cost-item create shares (S3)', () => {
  test('a code is required, printable and at most 120 characters', () => {
    expect(COST_ITEM_CODE_MAX).toBe(120);
    expect(readCostItemCode('  ')).toEqual({ ok: false, error: { code: 'code_required' } });
    expect(readCostItemCode(`A${NUL}B`)).toEqual({ ok: false, error: { code: 'unprintable' } });
    expect(readCostItemCode('C'.repeat(COST_ITEM_CODE_MAX + 1))).toEqual({ ok: false, error: { code: 'too_long', params: { max: COST_ITEM_CODE_MAX } } });
    expect(readCostItemCode(` ${'C'.repeat(COST_ITEM_CODE_MAX)} `)).toEqual({ ok: true, value: 'C'.repeat(COST_ITEM_CODE_MAX) });
  });

  test('a name may be blank, and is printable and at most 1,000 characters, counted in code points', () => {
    expect(COST_ITEM_NAME_MAX).toBe(1000);
    expect(readCostItemName('  ')).toEqual({ ok: true, value: null });
    expect(readCostItemName(`x${NUL}`)).toEqual({ ok: false, error: { code: 'unprintable' } });
    expect(readCostItemName('ن'.repeat(200000))).toEqual({ ok: false, error: { code: 'too_long', params: { max: COST_ITEM_NAME_MAX } } });
    expect(readCostItemName('😀'.repeat(COST_ITEM_NAME_MAX))).toEqual({ ok: true, value: '😀'.repeat(COST_ITEM_NAME_MAX) });
  });

  test('a code or name the item already holds passes unchanged, whatever its length or characters (N1)', () => {
    const longCode = 'BOQ-'.padEnd(214, '7');
    const longName = 'Supply and install'.repeat(80);
    expect(readCostItemCode(` ${longCode} `, longCode)).toEqual({ ok: true, value: longCode });
    expect(readCostItemName(longName, longName)).toEqual({ ok: true, value: longName });
    expect(readCostItemName(`x${String.fromCharCode(1)}`, `x${String.fromCharCode(1)}`)).toMatchObject({ ok: true });
    expect(readCostItemName(`${longName}!`, longName)).toEqual({ ok: false, error: { code: 'too_long', params: { max: COST_ITEM_NAME_MAX } } });
    expect(readCostItemCode('  ', longCode)).toEqual({ ok: false, error: { code: 'code_required' } });
  });

  test('the price book and the market add refuse the same text under the same fields', () => {
    const text = { code: 'C'.repeat(COST_ITEM_CODE_MAX + 1), nameEn: `x${NUL}`, nameAr: 'ن'.repeat(COST_ITEM_NAME_MAX + 1) };
    const refusals = { code: { code: 'too_long', params: { max: COST_ITEM_CODE_MAX } }, nameEn: { code: 'unprintable' }, nameAr: { code: 'too_long', params: { max: COST_ITEM_NAME_MAX } } };
    expect(costItemFieldErrors({ ...text, sectionId: 's', unit: 'sqm', defaultUnitCost: '1', defaultUnitPrice: '1' })).toEqual(refusals);
    expect(readAddMarketItemInput({ ...text, marketItemId: 'm', sectionId: 's' })).toEqual({ ok: false, errors: refusals });
  });
});
