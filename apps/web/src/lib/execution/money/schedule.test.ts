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
    const result = validateSchedule(percentRows('50', '30', '20'), '124000');
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
    expect(validateSchedule(percentRows('50', '30'), '124000')).toEqual({
      ok: false,
      errors: { milestones: { code: 'schedule_sum_mismatch', params: { expected: '100', actual: '80' } } },
    });
  });

  it('AC6: a mixed basis is refused under milestones', () => {
    const rows = [...percentRows('50'), ...amountRows('62000')];
    expect(validateSchedule(rows, '124000')).toEqual({
      ok: false,
      errors: { milestones: { code: 'contract_schedule_invalid' } },
    });
  });

  it('amounts must add up to the contract value to the piastre', () => {
    expect(validateSchedule(amountRows('62000', '62000'), '124000').ok).toBe(true);
    expect(validateSchedule(amountRows('62000', '61999.9999'), '124000')).toEqual({
      ok: false,
      errors: {
        milestones: { code: 'schedule_sum_mismatch', params: { expected: '124000', actual: '123999.9999' } },
      },
    });
  });

  it('a percent split with decimals that sums to exactly 100 is accepted', () => {
    expect(validateSchedule(percentRows('33.33', '33.33', '33.34'), '1000').ok).toBe(true);
  });

  it('refuses an empty schedule and one past 12 rows under milestones', () => {
    expect(validateSchedule([], '1000')).toEqual({ ok: false, errors: { milestones: { code: 'required' } } });
    const tooMany = percentRows(...Array.from({ length: MAX_SCHEDULE_ROWS + 1 }, () => '1'));
    expect(validateSchedule(tooMany, '1000')).toEqual({
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
    expect(validateSchedule(rows, '1000')).toEqual({
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

  it('refuses a zero, a negative or a share over the target under the value box', () => {
    const result = validateSchedule(percentRows('0', '-5', '100.0001'), '1000');
    expect(result).toEqual({
      ok: false,
      errors: {
        'milestones.0.value': { code: 'out_of_range', params: { min: '0.01', max: '100' } },
        'milestones.1.value': { code: 'not_negative' },
        'milestones.2.value': { code: 'out_of_range', params: { min: '0.01', max: '100' } },
      },
    });
    expect(validateSchedule(amountRows('2000'), '1000.5')).toEqual({
      ok: false,
      errors: { 'milestones.0.value': { code: 'out_of_range', params: { min: '0.01', max: '1000.5' } } },
    });
  });

  it('trims labels and keeps either language alone', () => {
    const rows: ScheduleRowInput[] = [{ labelAr: null, labelEn: '  On handover  ', basis: 'percent', value: '100' }];
    const result = validateSchedule(rows, '1000');
    expect(result.ok && result.rows[0]).toMatchObject({ labelAr: null, labelEn: 'On handover' });
  });
});
