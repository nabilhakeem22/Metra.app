import { describe, expect, it } from 'vitest';
import { MAX_SCHEDULE_ROWS, validateSchedule, type ScheduleRowInput } from './schedule';

function percentRows(...values: string[]): ScheduleRowInput[] {
  return values.map((value, index) => ({ labelAr: `دفعة ${index + 1}`, labelEn: null, basis: 'percent', value }));
}

function amountRows(...values: string[]): ScheduleRowInput[] {
  return values.map((value) => ({ labelAr: null, labelEn: 'Instalment', basis: 'amount', value }));
}

describe('validateSchedule', () => {
  it('accepts 50/30/20 and returns canonical rows in order', () => {
    const result = validateSchedule(percentRows('50', '30', '20'), '124000', '14000');
    expect(result).toEqual({
      ok: true,
      rows: [
        { labelAr: 'دفعة 1', labelEn: null, basis: 'percent', value: '50.0000', sortOrder: 0 },
        { labelAr: 'دفعة 2', labelEn: null, basis: 'percent', value: '30.0000', sortOrder: 1 },
        { labelAr: 'دفعة 3', labelEn: null, basis: 'percent', value: '20.0000', sortOrder: 2 },
      ],
    });
  });

  it('AC6: 50/30 refuses under milestones with expected 100, actual 80', () => {
    expect(validateSchedule(percentRows('50', '30'), '124000', '0')).toEqual({
      ok: false,
      errors: { milestones: { code: 'schedule_sum_mismatch', params: { expected: '100', actual: '80' } } },
    });
  });

  it('AC6: a mixed basis is refused under milestones', () => {
    const rows = [...percentRows('50'), ...amountRows('62000')];
    expect(validateSchedule(rows, '124000', '0')).toEqual({
      ok: false,
      errors: { milestones: { code: 'contract_schedule_invalid' } },
    });
  });

  it('amounts must add up to the contract value to the piastre', () => {
    expect(validateSchedule(amountRows('62000', '62000'), '124000', '0').ok).toBe(true);
    expect(validateSchedule(amountRows('62000', '61999.9999'), '124000', '0')).toEqual({
      ok: false,
      errors: {
        milestones: { code: 'schedule_sum_mismatch', params: { expected: '124000', actual: '123999.9999' } },
      },
    });
  });

  it('a percent split with decimals that sums to exactly 100 is accepted', () => {
    expect(validateSchedule(percentRows('33.33', '33.33', '33.34'), '1000', '0').ok).toBe(true);
  });

  it('refuses an empty schedule and one past 12 rows under milestones', () => {
    expect(validateSchedule([], '1000', '0')).toEqual({ ok: false, errors: { milestones: { code: 'required' } } });
    const tooMany = percentRows(...Array.from({ length: MAX_SCHEDULE_ROWS + 1 }, () => '1'));
    expect(validateSchedule(tooMany, '1000', '0')).toEqual({
      ok: false,
      errors: { milestones: { code: 'schedule_too_long' } },
    });
  });

  it('says every bad row at once, under its own label and value boxes', () => {
    const rows: ScheduleRowInput[] = [
      { labelAr: '  ', labelEn: null, basis: 'percent', value: '50' },
      { labelAr: 'ب', labelEn: null, basis: 'percent', value: '1,5' },
      { labelAr: 'ج', labelEn: 'x'.repeat(81), basis: 'percent', value: '' },
      { labelAr: 'د', labelEn: null, basis: 'percent', value: '٥٠' },
    ];
    expect(validateSchedule(rows, '1000', '0')).toEqual({
      ok: false,
      errors: {
        'milestones.0.label': { code: 'required' },
        'milestones.1.value': { code: 'not_a_number' },
        'milestones.2.label': { code: 'too_long', params: { max: 80 } },
        'milestones.2.value': { code: 'required' },
        'milestones.3.value': { code: 'not_a_number' },
      },
    });
  });

  it('counts a label of only invisible characters as empty (A3 F9), and stores it as none', () => {
    const invisible = ['​', '‏⁠', '؜  ', '﻿‍'];
    const rows: ScheduleRowInput[] = invisible.map((label) => ({ labelAr: null, labelEn: label, basis: 'percent', value: '25' }));
    const refused = validateSchedule(rows, '1000', '0');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(Object.keys(refused.errors)).toEqual(invisible.map((_, index) => `milestones.${index}.label`));
      for (const error of Object.values(refused.errors)) expect(error).toEqual({ code: 'required' });
    }
    const named = validateSchedule([{ labelAr: 'دفعة', labelEn: '​', basis: 'percent', value: '100' }], '1000', '0');
    expect(named).toMatchObject({ ok: true, rows: [{ labelAr: 'دفعة', labelEn: null }] });
  });

  it('refuses a zero, a negative or a share over the target under the value box', () => {
    const result = validateSchedule(percentRows('0', '-5', '100.0001'), '1000', '0');
    expect(result).toEqual({
      ok: false,
      errors: {
        'milestones.0.value': { code: 'out_of_range', params: { min: '0.01', max: '100' } },
        'milestones.1.value': { code: 'not_negative' },
        'milestones.2.value': { code: 'out_of_range', params: { min: '0.01', max: '100' } },
      },
    });
    expect(validateSchedule(amountRows('2000'), '1000.5', '0')).toEqual({
      ok: false,
      errors: { 'milestones.0.value': { code: 'out_of_range', params: { min: '0.01', max: '1000.5' } } },
    });
  });

  it('trims labels and keeps either language alone', () => {
    const rows: ScheduleRowInput[] = [{ labelAr: null, labelEn: '  On handover  ', basis: 'percent', value: '100' }];
    const result = validateSchedule(rows, '1000', '0');
    expect(result.ok && result.rows[0]).toMatchObject({ labelAr: null, labelEn: 'On handover' });
  });

  it('F7: refuses a contract value too small for its split, under milestones', () => {
    // 50% of 0.0001 rounds to 0.0001, leaving 0 for the last row.
    expect(validateSchedule(percentRows('50', '50'), '0.0001', '0')).toEqual({
      ok: false,
      errors: { milestones: { code: 'schedule_value_too_small', params: { value: '0.0001' } } },
    });
    // Two thirds round up to 0.0001 each and leave nothing for the third.
    expect(validateSchedule(percentRows('33.33', '33.33', '33.34'), '0.0002', '0')).toEqual({
      ok: false,
      errors: { milestones: { code: 'schedule_value_too_small', params: { value: '0.0002' } } },
    });
  });

  it('F7: a contract value of 0 or below is too small for any split, before any row is read', () => {
    const tooSmall = { ok: false, errors: { milestones: { code: 'schedule_value_too_small', params: { value: '0' } } } };
    expect(validateSchedule(percentRows('50', '50'), '0', '0')).toEqual(tooSmall);
    expect(validateSchedule(amountRows('10'), '0', '0')).toEqual(tooSmall);
  });

  it('accepts the same split once every row bills at least a piastre fraction', () => {
    expect(validateSchedule(percentRows('50', '50'), '0.0002', '0').ok).toBe(true);
    expect(validateSchedule(percentRows('33.33', '33.33', '33.34'), '0.0003', '0').ok).toBe(true);
  });

  it('F6: a low-VAT schedule with a tiny last row is accepted with no negative VAT', () => {
    const rows = amountRows(...Array.from({ length: 10 }, () => '9090.5000'), '919094.9900', '0.0100');
    const result = validateSchedule(rows, '1010000.0000', '10000.0000');
    expect(result.ok).toBe(true);
  });

  it('F6: refuses a split whose VAT share on some row would fall below 0 or above its amount', () => {
    // VAT larger than the value: some row must carry more VAT than its amount.
    expect(validateSchedule(percentRows('50', '50'), '0.0002', '0.0003')).toEqual({
      ok: false,
      errors: { milestones: { code: 'schedule_value_too_small', params: { value: '0.0002' } } },
    });
  });
});
