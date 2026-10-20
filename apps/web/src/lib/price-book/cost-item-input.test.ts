import { describe, expect, test } from 'vitest';
import { readAddMarketItemInput } from '@/lib/market-book/add-input';
import { MAX_LABEL_CHARS } from '@/lib/validation/text';
import { hasCostItemInputShape, readCostItemCode, readCostItemName } from './cost-item-input';
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
  test('a code is required, printable and at most MAX_LABEL_CHARS characters', () => {
    expect(readCostItemCode('  ')).toEqual({ ok: false, error: { code: 'code_required' } });
    expect(readCostItemCode(`A${NUL}B`)).toEqual({ ok: false, error: { code: 'unprintable' } });
    expect(readCostItemCode('C'.repeat(MAX_LABEL_CHARS + 1))).toEqual({ ok: false, error: { code: 'too_long', params: { max: MAX_LABEL_CHARS } } });
    expect(readCostItemCode(` ${'C'.repeat(MAX_LABEL_CHARS)} `)).toEqual({ ok: true, value: 'C'.repeat(MAX_LABEL_CHARS) });
  });

  test('a name may be blank, and is printable and capped in code points', () => {
    expect(readCostItemName('  ')).toEqual({ ok: true, value: null });
    expect(readCostItemName(`x${NUL}`)).toEqual({ ok: false, error: { code: 'unprintable' } });
    expect(readCostItemName('ن'.repeat(200000))).toEqual({ ok: false, error: { code: 'too_long', params: { max: MAX_LABEL_CHARS } } });
    expect(readCostItemName('😀'.repeat(MAX_LABEL_CHARS))).toEqual({ ok: true, value: '😀'.repeat(MAX_LABEL_CHARS) });
  });

  test('the price book and the market add refuse the same text under the same fields', () => {
    const text = { code: 'C'.repeat(MAX_LABEL_CHARS + 1), nameEn: `x${NUL}`, nameAr: 'ن'.repeat(MAX_LABEL_CHARS + 1) };
    const refusals = { code: { code: 'too_long', params: { max: MAX_LABEL_CHARS } }, nameEn: { code: 'unprintable' }, nameAr: { code: 'too_long', params: { max: MAX_LABEL_CHARS } } };
    expect(costItemFieldErrors({ ...text, sectionId: 's', unit: 'sqm', defaultUnitCost: '1', defaultUnitPrice: '1' })).toEqual(refusals);
    expect(readAddMarketItemInput({ ...text, marketItemId: 'm', sectionId: 's' })).toEqual({ ok: false, errors: refusals });
  });
});
