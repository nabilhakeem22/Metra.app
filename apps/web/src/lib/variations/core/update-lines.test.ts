import { describe, expect, it } from 'vitest';
import { MAX_TOTAL_LINES } from '@/lib/lines/limits';
import type { VariationLineInput } from './types';
import { validateVariationLines } from './update-lines';

// This half of saveVariationDraftCore used to be 80 lines inside a function that
// also opened a transaction, so its ONLY coverage was variations.dbtest.ts — a
// CI-only suite that takes the better part of an hour. It is pure, so it can be
// proved in milliseconds, and that is what makes splitting the core safe.

const line = (patch: Partial<VariationLineInput> = {}): VariationLineInput => ({
  descriptionEn: 'Add doors',
  qty: '3',
  unit: 'pcs',
  unitCost: '100',
  unitPrice: '200',
  discountPct: '0',
  ...patch,
});

/** The whole-VO refusal code ('check_fields' when cells were refused). */
const errorOf = (lines: VariationLineInput[]) => {
  const result = validateVariationLines(lines);
  return result.ok ? null : result.refusal.error;
};

/** Every cell refusal, by path, as its code. */
const fieldsOf = (lines: VariationLineInput[]) => {
  const result = validateVariationLines(lines);
  if (result.ok) return null;
  return Object.fromEntries(
    Object.entries(result.refusal.fields ?? {}).map(([path, error]) => [path, error?.code]),
  );
};

describe('validateVariationLines', () => {
  it('recomputes every figure from the money engine, ignoring client totals', () => {
    const result = validateVariationLines([line()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].lineTotal).toBe('600.0000');
    expect(result.lines[0].lineCost).toBe('300.0000');
    expect(result.netDelta).toBe('600.0000');
  });

  it('carries a NEGATIVE de-scope all the way through to a negative netDelta', () => {
    // The reason variations cannot borrow the proposal's line validator.
    const result = validateVariationLines([
      line({ descriptionEn: 'Cut scope', qty: '-2', unit: 'lump_sum', unitCost: '0', unitPrice: '500' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].lineTotal).toBe('-1000.0000');
    expect(result.netDelta).toBe('-1000.0000');
  });

  it('nets an add against a de-scope', () => {
    const result = validateVariationLines([
      line(),
      line({ descriptionEn: 'Remove a wall', qty: '-1', unit: 'lump_sum', unitCost: '0', unitPrice: '150' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netDelta).toBe('450.0000');
  });

  it('numbers lines by position when the client omits sortOrder', () => {
    const result = validateVariationLines([line(), line({ descriptionEn: 'Second' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((l) => l.sortOrder)).toEqual([0, 1]);
  });

  it('honours an explicit sortOrder', () => {
    const result = validateVariationLines([line({ sortOrder: 7 })]);
    expect(result.ok && result.lines[0].sortOrder).toBe(7);
  });

  it('requires a description in at least one language', () => {
    expect(fieldsOf([line({ descriptionEn: '  ', descriptionAr: null })])).toEqual({
      'lines.0.description': 'description_required',
    });
    expect(validateVariationLines([line({ descriptionEn: null, descriptionAr: 'باب' })]).ok).toBe(
      true,
    );
  });

  it('refuses a line with no unit', () => {
    expect(fieldsOf([line({ unit: null })])).toEqual({ 'lines.0.unit': 'required' });
  });

  it('tells an unreadable figure apart from one past the cap', () => {
    // A bare `invalid` on a quantity of 1e13 tells the studio nothing it can act
    // on — it can see perfectly well that the cell IS a number.
    expect(fieldsOf([line({ qty: 'abc' })])).toEqual({ 'lines.0.qty': 'not_a_number' });
    expect(fieldsOf([line({ qty: '10000000000000' })])).toEqual({ 'lines.0.qty': 'amount_too_large' });
    expect(fieldsOf([line({ unitPrice: '99999999999999' })])).toEqual({
      'lines.0.unitPrice': 'amount_too_large',
    });
  });

  it('refuses a discount outside [0,100]', () => {
    expect(fieldsOf([line({ discountPct: '101' })])).toEqual({
      'lines.0.discountPct': 'discount_out_of_range',
    });
    expect(fieldsOf([line({ discountPct: '-1' })])).toEqual({ 'lines.0.discountPct': 'not_negative' });
    expect(validateVariationLines([line({ discountPct: '100' })]).ok).toBe(true);
  });

  it('refuses a PRODUCT past the cap even when every factor is inside it', () => {
    // qty and unitPrice are each legal; qty * unitPrice is not. The per-factor
    // checks do not imply this one.
    expect(
      fieldsOf([line({ qty: '999999999', unitPrice: '999999999', unitCost: '0' })]),
    ).toEqual({ 'lines.0.qty': 'amount_too_large' });
  });

  it('refuses a SUM past the cap even when every line is inside it', () => {
    const big = line({ qty: '1', unitPrice: '900000000000', unitCost: '0' });
    expect(errorOf([big, big])).toBe('amount_too_large');
  });

  it('refuses more lines than a document may hold, before reading any of them', () => {
    const tooMany = Array.from({ length: MAX_TOTAL_LINES + 1 }, () => line());
    expect(errorOf(tooMany)).toBe('too_many_lines');
    // And a line set exactly at the cap is fine.
    expect(validateVariationLines(Array.from({ length: 3 }, () => line())).ok).toBe(true);
  });

  it('accepts an empty line set — a VO may be emptied back to nothing', () => {
    const result = validateVariationLines([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([]);
    expect(result.netDelta).toBe('0.0000');
  });

  it('refuses every bad cell at once, each under its own line', () => {
    expect(errorOf([line(), line({ qty: 'abc' })])).toBe('check_fields');
    expect(fieldsOf([line(), line({ qty: 'abc', unitPrice: 'x' }), line({ unit: null })])).toEqual({
      'lines.1.qty': 'not_a_number',
      'lines.1.unitPrice': 'not_a_number',
      'lines.2.unit': 'required',
    });
  });
});
