import { describe, expect, it } from 'vitest';
import { requestOutstanding } from './outstanding';

describe('requestOutstanding', () => {
  it('is the full amount with no payment', () => {
    expect(requestOutstanding('500', [])).toBe('500.0000');
  });

  it('subtracts every partial payment to the piastre', () => {
    expect(requestOutstanding('62000', ['20000', '15000.5'])).toBe('26999.5000');
  });

  it('is zero once paid in full', () => {
    expect(requestOutstanding('500', ['200', '300'])).toBe('0.0000');
  });

  it('never shows a negative balance, even on a ledger that over-paid', () => {
    expect(requestOutstanding('500', ['600'])).toBe('0.0000');
  });
});
