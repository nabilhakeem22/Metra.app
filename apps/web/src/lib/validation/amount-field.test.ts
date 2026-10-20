import { describe, expect, it, vi } from 'vitest';
import { readPaymentAmount } from '@/lib/engagements/payment-field-rules';
import { validateFeeSchedule } from '@/lib/engagements/fee-schedule';
import { readChangeOrderAmount } from '@/lib/engagements/revision-field-rules';
import { readRomRange } from '@/lib/engagements/rom-field-rules';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { readPositiveAmount, readPositiveExactAmount, readTypedMoney } from './amount-field';

// validateFeeSchedule sits beside its server-only runner; the reader under test is pure.
vi.mock('server-only', () => ({}));

const MISSING = { code: 'payment_amount_invalid' } as const;

describe('readTypedMoney: what studios type', () => {
  it.each(['1500', '1,500', '١٥٠٠', '١,٥٠٠', '1500 EGP', 'EGP 1,500', '1500 ج.م', '1500ج.م', ' 1,500.00 LE '])(
    'reads %j as 1500',
    (typed) => {
      const read = readTypedMoney(typed);
      expect(read.ok && formatMoney4(parseMoney4(read.value))).toBe('1500.0000');
      expect(readPositiveAmount(typed, MISSING)).toEqual({ ok: true, value: '1500.0000' });
    },
  );

  it('still refuses the ambiguous comma, and says why', () => {
    expect(readTypedMoney('1,5')).toEqual({ ok: false, error: { code: 'not_a_number' } });
    expect(readTypedMoney('abc')).toEqual({ ok: false, error: { code: 'not_a_number' } });
    expect(readTypedMoney('-5')).toEqual({ ok: false, error: { code: 'not_negative' } });
  });

  it('refuses a figure past the column cap before any write (22003)', () => {
    expect(readTypedMoney('123456789012345')).toEqual({ ok: false, error: { code: 'amount_too_large' } });
  });
});

describe('readPositiveAmount', () => {
  it('says "enter an amount" only for an empty box or a zero', () => {
    expect(readPositiveAmount('', MISSING)).toEqual({ ok: false, error: MISSING });
    expect(readPositiveAmount('0', MISSING)).toEqual({ ok: false, error: MISSING });
    expect(readPositiveAmount('1,5', MISSING)).toEqual({ ok: false, error: { code: 'not_a_number' } });
  });
});

describe('readPositiveExactAmount: the contract ledger refuses a fifth decimal (A4 F8)', () => {
  const TOO_MANY = { ok: false, error: { code: 'too_many_decimals', params: { max: 4 } } };

  it.each(['100.12345', '100.00005', '0.00001', '1,000.12345 EGP', '١٠٠٫١٢٣٤٥'])('refuses %j, never cuts it', (typed) => {
    expect(readPositiveExactAmount(typed, MISSING)).toEqual(TOO_MANY);
  });

  it('reads four decimals and fewer as readPositiveAmount does', () => {
    for (const typed of ['100.1234', '1,500', '١٥٠٠ ج.م', '7.5']) {
      expect(readPositiveExactAmount(typed, MISSING)).toEqual(readPositiveAmount(typed, MISSING));
    }
    expect(readPositiveExactAmount('', MISSING)).toEqual({ ok: false, error: MISSING });
    expect(readPositiveExactAmount('1,5', MISSING)).toEqual({ ok: false, error: { code: 'not_a_number' } });
    expect(readPositiveExactAmount(100, MISSING)).toEqual({ ok: false, error: MISSING });
  });

  it('leaves the older callers cutting as they did', () => {
    expect(readPositiveAmount('100.12345', MISSING)).toEqual({ ok: true, value: '100.1234' });
  });
});

describe('every money box reads the same way (F2, F6)', () => {
  it('payment amount', () => {
    expect(readPaymentAmount('1,500')).toEqual({ ok: true, value: '1500.0000' });
    expect(readPaymentAmount('١٥٠٠ ج.م')).toEqual({ ok: true, value: '1500.0000' });
    expect(readPaymentAmount('123456789012345')).toEqual({ ok: false, error: { code: 'amount_too_large' } });
  });

  it('design fee', () => {
    const split = [{ kind: 'deposit', basis: 'percent', value: '100' }];
    expect(validateFeeSchedule({ designFee: '1,500', milestones: split }).ok).toBe(true);
    expect(validateFeeSchedule({ designFee: 'abc', milestones: split })).toEqual({
      ok: false,
      field: 'designFee',
      error: { code: 'not_a_number' },
    });
    expect(validateFeeSchedule({ designFee: '123456789012345', milestones: split })).toEqual({
      ok: false,
      field: 'designFee',
      error: { code: 'amount_too_large' },
    });
  });

  it('build-cost range', () => {
    expect(readRomRange({ romLow: '900,000', romHigh: '1,200,000 EGP' })).toEqual({
      ok: true,
      romLow: '900000.0000',
      romHigh: '1200000.0000',
    });
    expect(readRomRange({ romLow: '1', romHigh: '123456789012345' })).toEqual({
      ok: false,
      errors: { romHigh: { code: 'amount_too_large' } },
    });
  });

  it('a revision change order', () => {
    expect(readChangeOrderAmount('5,000 ج.م')).toEqual({ ok: true, value: '5000.0000' });
    expect(readChangeOrderAmount('5o')).toEqual({ ok: false, error: { code: 'not_a_number' } });
    expect(readChangeOrderAmount('0')).toEqual({ ok: false, error: { code: 'revision_co_amount_required' } });
  });
});
