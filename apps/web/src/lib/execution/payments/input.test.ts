import { describe, expect, it } from 'vitest';
import { formatDate } from '@/lib/format/date';
import { dayBeforeIssue } from '@/lib/validation/day-field';
import { contractPaymentFieldErrors, readContractPayment } from './input';

// A4 F5 and F8: the day a payment was received, and its amount, as the record
// dialog and the core both read them.

const TODAY = '2026-10-20';

describe('the day a payment was received', () => {
  it('refuses a two-digit year typed into the date box, and anything before 2000, as not a date', () => {
    for (const day of ['0026-10-20', '0001-01-01', '1999-12-31']) {
      expect(readContractPayment({ amount: '10', receivedOn: day }, TODAY), day).toEqual({ ok: false, errors: { receivedOn: { code: 'invalid_date' } } });
    }
    expect(readContractPayment({ amount: '10', receivedOn: '2000-01-01' }, TODAY).ok).toBe(true);
  });

  it('refuses a day before the contract was issued, with the issue day as the app shows it', () => {
    expect(dayBeforeIssue('2026-10-19', '2026-10-20')).toEqual({ code: 'date_before_issue', params: { date: formatDate('2026-10-20', 'en') } });
    expect(dayBeforeIssue('2026-10-20', '2026-10-20')).toBeNull();
    expect(contractPaymentFieldErrors({ amount: '10', receivedOn: '2020-01-01' }, TODAY, '2026-10-01')).toEqual({
      receivedOn: { code: 'date_before_issue', params: { date: '01/10/2026' } },
    });
    expect(contractPaymentFieldErrors({ amount: '10', receivedOn: '2026-10-02' }, TODAY, '2026-10-01')).toEqual({});
  });

  it('says the box rules first: a day in the future is that, whatever the issue day', () => {
    expect(contractPaymentFieldErrors({ amount: '10', receivedOn: '2026-10-21' }, TODAY, '2026-10-01')).toEqual({
      receivedOn: { code: 'date_in_future' },
    });
  });
});

describe('the amount', () => {
  it('refuses a fifth decimal instead of cutting it', () => {
    expect(readContractPayment({ amount: '100.12345', receivedOn: TODAY }, TODAY)).toEqual({
      ok: false,
      errors: { amount: { code: 'too_many_decimals', params: { max: 4 } } },
    });
    expect(readContractPayment({ amount: '100.1234', receivedOn: TODAY }, TODAY)).toMatchObject({ ok: true, values: { amount: '100.1234' } });
  });
});
