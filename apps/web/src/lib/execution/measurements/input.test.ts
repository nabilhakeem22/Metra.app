import { describe, expect, it } from 'vitest';
import { measurementFieldErrors, readMeasurement } from './input';

// A5.1: the final measured quantity of a line, as the record dialog and the
// core both read it.

const TODAY = '2026-11-20';
const ISSUED = '2026-10-01';

describe('readMeasurement', () => {
  it('keeps the quantity at scale 4, read the way studios type it, zero included', () => {
    expect(readMeasurement({ measuredQty: '1,250.5', measuredOn: TODAY }, TODAY)).toEqual({
      ok: true,
      values: { measuredQty: '1250.5000', measuredOn: TODAY, note: null },
    });
    expect(readMeasurement({ measuredQty: '٢٤٠', measuredOn: TODAY }, TODAY)).toMatchObject({ ok: true, values: { measuredQty: '240.0000' } });
    expect(readMeasurement({ measuredQty: '0', measuredOn: TODAY, note: '  not built  ' }, TODAY)).toMatchObject({
      ok: true,
      values: { measuredQty: '0.0000', note: 'not built' },
    });
  });

  it('refuses every box that is wrong at once, under its own box', () => {
    expect(readMeasurement({ measuredQty: '', measuredOn: '', note: 'x'.repeat(501) }, TODAY)).toEqual({
      ok: false,
      errors: { measuredQty: { code: 'required' }, measuredOn: { code: 'required' }, note: { code: 'too_long', params: { max: 500 } } },
    });
  });

  it('refuses a quantity below zero, one that is not a number, a fifth decimal and a comma decimal', () => {
    const qty = (measuredQty: unknown) => readMeasurement({ measuredQty, measuredOn: TODAY }, TODAY);
    expect(qty('-1')).toEqual({ ok: false, errors: { measuredQty: { code: 'not_negative' } } });
    expect(qty('abc')).toEqual({ ok: false, errors: { measuredQty: { code: 'not_a_number' } } });
    expect(qty('1.00001')).toEqual({ ok: false, errors: { measuredQty: { code: 'too_many_decimals', params: { max: 4 } } } });
    expect(qty('1,5')).toEqual({ ok: false, errors: { measuredQty: { code: 'not_a_number' } } });
    expect(qty(12)).toEqual({ ok: false, errors: { measuredQty: { code: 'required' } } });
  });

  it('refuses a day after today, a two-digit year, and a day that is not one', () => {
    const day = (measuredOn: unknown) => readMeasurement({ measuredQty: '1', measuredOn }, TODAY);
    expect(day('2026-11-21')).toEqual({ ok: false, errors: { measuredOn: { code: 'date_in_future' } } });
    expect(day('0026-11-20')).toEqual({ ok: false, errors: { measuredOn: { code: 'invalid_date' } } });
    expect(day('2026-02-30')).toEqual({ ok: false, errors: { measuredOn: { code: 'invalid_date' } } });
  });
});

describe('measurementFieldErrors', () => {
  it('refuses a day before the contract was issued, with the issue day as the app shows it', () => {
    expect(measurementFieldErrors({ measuredQty: '1', measuredOn: '2026-09-30' }, TODAY, ISSUED)).toEqual({
      measuredOn: { code: 'date_before_issue', params: { date: '01/10/2026' } },
    });
    expect(measurementFieldErrors({ measuredQty: '1', measuredOn: ISSUED }, TODAY, ISSUED)).toEqual({});
  });
});
