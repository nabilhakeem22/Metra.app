import { COST_ITEM_UNITS } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT, readMoneyString } from '@/lib/money/read';
import {
  BOQ_UNITS,
  MAX_DESCRIPTION,
  MAX_ITEM_CODE,
  normalizeLinePatch,
} from './edit-input';

// The EXACT option set boqs/edit-input.ts uses for a field the studio types into
// the sheet. Named here so these cases keep testing that call site's rule rather
// than the kernel's defaults.
const readTypedField = (raw: string) =>
  readMoneyString(raw, { allowGroupSeparators: true });

describe('BOQ_UNITS', () => {
  // The list lives in a client-safe module rather than being imported from the
  // database package; this is what keeps that from drifting into a lie.
  it('is exactly the cost_item_unit enum, in the same order', () => {
    expect([...BOQ_UNITS]).toEqual([...COST_ITEM_UNITS]);
  });
});

describe('a typed sheet field', () => {
  it('accepts a plain number', () => {
    // clampMoney4 deliberately does not canonicalise -- '5' stays '5' rather
    // than becoming '5.0000', so only genuinely ambiguous >4dp input changes.
    expect(readTypedField('1500')).toBe('1500');
    expect(readTypedField('8.5')).toBe('8.5');
    expect(readTypedField('0')).toBe('0');
  });

  it('strips the separators people actually type', () => {
    expect(readTypedField('1,500.00')).toBe('1500.00');
    expect(readTypedField(' 38 000 ')).toBe('38000');
    expect(readTypedField('1٬270')).toBe('1270');
  });

  it('REFUSES an ambiguous comma that this field used to read as grouping', () => {
    // BEHAVIOUR CHANGE (wave 2). readNumericField stripped every comma, so '1,5'
    // — one and a half, as a great many people write it — became 15 and was
    // saved as the rate on a document the client signs. It is now an invalid
    // field the studio can see, not a ten-fold error nobody can.
    for (const ambiguous of ['1,5', '1,2,3', '1.234,56', '1,23']) {
      expect(readTypedField(ambiguous)).toBeNull();
    }
  });

  it('REFUSES rather than reading a typo as zero', () => {
    // The whole point of not reusing coerceMoneyInput here: each of these would
    // silently become '0' and change the money on a document a client signs.
    for (const bad of ['abc', '1.5.0', '12x', '--3', '1e5', '', '   ']) {
      expect(readTypedField(bad)).toBeNull();
    }
  });

  it('refuses a negative — that is a variation order, not a BOQ line', () => {
    expect(readTypedField('-1')).toBeNull();
    expect(readTypedField('-0.5')).toBeNull();
  });

  it('clamps to the stored scale of 4', () => {
    expect(readTypedField('1.23456')).toBe('1.2345');
  });
});

describe('normalizeLinePatch', () => {
  it('passes a whole valid line through', () => {
    const res = normalizeLinePatch({
      itemCode: ' 2.03 ',
      description: '  12mm gypsum ceiling  ',
      unit: 'sqm',
      qty: '100',
      unitPrice: '1,500.00',
      provisional: true,
    });
    expect(res).toEqual({
      ok: true,
      value: {
        itemCode: '2.03',
        description: '12mm gypsum ceiling',
        unit: 'sqm',
        qty: '100',
        unitPrice: '1500.00',
        provisional: true,
      },
    });
  });

  it('touches only the keys it was given', () => {
    const res = normalizeLinePatch({ qty: '4' });
    expect(res).toEqual({ ok: true, value: { qty: '4' } });
  });

  it('lets an item code be cleared, but not a description', () => {
    expect(normalizeLinePatch({ itemCode: '  ' })).toEqual({
      ok: true,
      value: { itemCode: null },
    });
    expect(normalizeLinePatch({ description: '   ' })).toEqual({
      ok: false,
      error: 'description_required',
    });
  });

  it('refuses a unit outside the enum', () => {
    expect(normalizeLinePatch({ unit: 'sqft' })).toEqual({
      ok: false,
      error: 'invalid_unit',
    });
  });

  it('names which field was wrong', () => {
    expect(normalizeLinePatch({ qty: 'ten' }).ok).toBe(false);
    expect(normalizeLinePatch({ qty: 'ten' })).toEqual({
      ok: false,
      error: 'invalid_qty',
    });
    expect(normalizeLinePatch({ unitPrice: '£5' })).toEqual({
      ok: false,
      error: 'invalid_price',
    });
  });

  it('caps the free-text columns', () => {
    expect(normalizeLinePatch({ itemCode: 'x'.repeat(MAX_ITEM_CODE + 1) })).toEqual({
      ok: false,
      error: 'item_code_too_long',
    });
    expect(
      normalizeLinePatch({ description: 'x'.repeat(MAX_DESCRIPTION + 1) }),
    ).toEqual({ ok: false, error: 'description_too_long' });
  });

  it('refuses an amount past the magnitude cap the import already enforces', () => {
    // 1e17: storable as a factor, but its product with any rate overflows
    // numeric(18,4) — the sheet was the one money surface that let it through.
    //
    // THE EXPECTATION MOVED BACK. For one wave this asserted 'invalid_qty',
    // because the reader answered a single `null` for every failure and the
    // field could only report its own code — so a studio pasting 1e17 was told
    // its number was not a number. readMoney now says WHICH failure it was, and
    // 'amount_too_large' is both the truth and what main said. The same code
    // still covers the case it always covered: a computed line TOTAL that
    // overflows from factors which each fit.
    expect(normalizeLinePatch({ qty: '100000000000000000' })).toEqual({
      ok: false,
      error: 'amount_too_large',
    });
    expect(normalizeLinePatch({ unitPrice: String(MAX_AMOUNT + 1) })).toEqual({
      ok: false,
      error: 'amount_too_large',
    });
    // A cell that genuinely is not a number still gets the field's own code.
    expect(normalizeLinePatch({ qty: 'twelve' })).toEqual({
      ok: false,
      error: 'invalid_qty',
    });
    // The cap itself is still acceptable.
    expect(normalizeLinePatch({ qty: String(MAX_AMOUNT) }).ok).toBe(true);
  });

  it('refuses an empty patch instead of answering ok to a no-op', () => {
    expect(normalizeLinePatch({})).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses a non-boolean provisional', () => {
    expect(
      normalizeLinePatch({ provisional: 'yes' as unknown as boolean }),
    ).toEqual({ ok: false, error: 'invalid' });
  });
});
