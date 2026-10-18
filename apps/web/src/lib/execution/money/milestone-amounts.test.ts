import { describe, expect, it } from 'vitest';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { milestoneAmounts, type MilestoneAmount } from './milestone-amounts';
import type { CleanScheduleRow } from './schedule';

function rows(basis: 'percent' | 'amount', ...values: string[]): CleanScheduleRow[] {
  return values.map((value, sortOrder) => ({ labelAr: 'دفعة', labelEn: null, basis, value, sortOrder }));
}

function total(amounts: MilestoneAmount[], key: keyof MilestoneAmount): string {
  return formatMoney4(amounts.reduce((sum, row) => sum + parseMoney4(row[key]), 0n));
}

describe('milestoneAmounts', () => {
  it('AC5: 50/30/20 on 100,000.0001 sums exactly; the last row takes the remainder', () => {
    const amounts = milestoneAmounts(rows('percent', '50', '30', '20'), '100000.0001', '0');
    // 50% of 100,000.0001 = 50,000.00005 -> 50,000.0001 (half away from zero)
    expect(amounts.map((row) => row.amount)).toEqual(['50000.0001', '30000.0000', '20000.0000']);
    expect(total(amounts, 'amount')).toBe('100000.0001');
  });

  it('splits the VAT by the same percentages, remainder on the last row', () => {
    // 124,000 contract with 14,000 VAT inside it.
    const amounts = milestoneAmounts(rows('percent', '50', '30', '20'), '124000', '14000');
    expect(amounts).toEqual([
      { amount: '62000.0000', taxAmount: '7000.0000' },
      { amount: '37200.0000', taxAmount: '4200.0000' },
      { amount: '24800.0000', taxAmount: '2800.0000' },
    ]);
  });

  it('thirds of an odd value still add up to the value and the VAT', () => {
    const amounts = milestoneAmounts(rows('percent', '33.33', '33.33', '33.34'), '1000.0001', '120.0001');
    expect(amounts.map((row) => row.amount)).toEqual(['333.3000', '333.3000', '333.4001']);
    expect(total(amounts, 'amount')).toBe('1000.0001');
    expect(total(amounts, 'taxAmount')).toBe('120.0001');
  });

  it('an amount schedule bills each row as typed and shares the VAT by weight', () => {
    const amounts = milestoneAmounts(rows('amount', '40000', '84000'), '124000', '14000');
    // 14,000 x 40,000 / 124,000 = 4,516.12903... -> 4,516.1290
    expect(amounts).toEqual([
      { amount: '40000.0000', taxAmount: '4516.1290' },
      { amount: '84000.0000', taxAmount: '9483.8710' },
    ]);
  });

  it('never bills a row more VAT than its amount', () => {
    const amounts = milestoneAmounts(rows('percent', '10', '10', '80'), '0.0010', '0.0009');
    for (const row of amounts) expect(parseMoney4(row.taxAmount) <= parseMoney4(row.amount)).toBe(true);
    expect(total(amounts, 'taxAmount')).toBe('0.0009');
  });

  it('a single row is the whole contract', () => {
    expect(milestoneAmounts(rows('percent', '100'), '5000', '600')).toEqual([
      { amount: '5000.0000', taxAmount: '600.0000' },
    ]);
  });

  it('throws on a negative figure in the VAT share: a caller bug, never valid input', () => {
    expect(() => milestoneAmounts(rows('amount', '100', '100'), '200', '-10')).toThrow(
      'proportionalShare: negative input',
    );
    expect(() => milestoneAmounts(rows('amount', '-100', '300'), '200', '10')).toThrow(
      'proportionalShare: negative input',
    );
  });

  it('F6: the VAT remainder goes to the largest row, never driving a tiny last row negative', () => {
    // 1,000,000 BOQ at 1% VAT: 1,010,000 with 10,000 VAT; ten rows of 9,090.5,
    // one of 919,094.99 and a last row of 0.01. Each of the first eleven rounds
    // its VAT share up, which used to leave -0.0004 on the last row.
    const schedule = rows('amount', ...Array.from({ length: 10 }, () => '9090.5000'), '919094.9900', '0.0100');
    const amounts = milestoneAmounts(schedule, '1010000.0000', '10000.0000');
    for (const row of amounts) {
      expect(parseMoney4(row.taxAmount) >= 0n).toBe(true);
      expect(parseMoney4(row.taxAmount) <= parseMoney4(row.amount)).toBe(true);
    }
    expect(amounts[11]).toEqual({ amount: '0.0100', taxAmount: '0.0001' });
    expect(total(amounts, 'amount')).toBe('1010000.0000');
    expect(total(amounts, 'taxAmount')).toBe('10000.0000');
  });

  it('the amount remainder stays on the last row while a larger earlier row takes the VAT remainder', () => {
    const amounts = milestoneAmounts(rows('percent', '60', '40'), '1000.0001', '120.0001');
    // 60% of 1,000.0001 = 600.00006 -> 600.0001; the last row takes 400.0000.
    expect(amounts.map((row) => row.amount)).toEqual(['600.0001', '400.0000']);
    // 40% of 120.0001 = 48.00004 -> 48.0000; the larger first row takes 72.0001.
    expect(amounts.map((row) => row.taxAmount)).toEqual(['72.0001', '48.0000']);
  });

  it('on a tie for the largest amount the last of them takes the VAT remainder', () => {
    const amounts = milestoneAmounts(rows('percent', '50', '50'), '100', '0.0003');
    // 50% of 0.0003 = 0.00015 -> 0.0002 on the first; the tied last row takes 0.0001.
    expect(amounts).toEqual([
      { amount: '50.0000', taxAmount: '0.0002' },
      { amount: '50.0000', taxAmount: '0.0001' },
    ]);
  });
});
