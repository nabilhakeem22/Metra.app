import { describe, expect, it } from 'vitest';
import { billingBalance, computeFinalAccount, finalAccountBalance, type FinalAccountInput, type MeasuredLine } from './final-account';

function line(overrides: Partial<MeasuredLine> & Pick<MeasuredLine, 'lineId'>): MeasuredLine {
  return {
    qty: '0',
    unitPrice: '0',
    discountPct: '0',
    provisional: false,
    measuredQty: '0',
    variationQty: '0',
    ...overrides,
  };
}

// AC26's three lines, on a contract with VAT 14 and supervision 10.
const provisional = line({ lineId: 'p', qty: '200', unitPrice: '100', provisional: true, measuredQty: '240' });
const firmCovered = line({ lineId: 'f1', qty: '8', unitPrice: '500', measuredQty: '12', variationQty: '4' });
const firmUncovered = line({ lineId: 'f2', qty: '8', unitPrice: '500', measuredQty: '10' });

const base: FinalAccountInput = {
  originalValue: '124000',
  taxRate: '14',
  supervisionPct: '10',
  discountPct: '0',
  approvedVariationNetDeltas: [],
  measuredLines: [provisional, firmCovered, firmUncovered],
  issuedRequestsTotal: '124000',
};

describe('computeFinalAccount', () => {
  it('AC26: only the provisional line bills its measured difference', () => {
    const account = computeFinalAccount(base);
    expect(account.billedLines).toEqual([{ lineId: 'p', residualQty: '40.0000', works: '4000.0000' }]);
    expect(account.adjustmentWorks).toBe('4000.0000');
    // 4,000 + 560 VAT + 400 supervision
    expect(account.adjustmentCharge).toBe('4960.0000');
  });

  it('AC26: a firm line covered by a change order is neither billed nor flagged', () => {
    const account = computeFinalAccount({ ...base, measuredLines: [firmCovered] });
    expect(account.billedLines).toEqual([]);
    expect(account.flaggedLines).toEqual([]);
    expect(account.adjustmentCharge).toBe('0.0000');
  });

  it('AC26: a firm line measured over its quantity adds nothing and is flagged', () => {
    const account = computeFinalAccount({ ...base, measuredLines: [firmUncovered] });
    expect(account.billedLines).toEqual([]);
    expect(account.flaggedLines).toEqual([{ lineId: 'f2', residualQty: '2.0000' }]);
    expect(account.adjustmentCharge).toBe('0.0000');
  });

  it('adds approved change orders with VAT and supervision, de-scopes lowering it', () => {
    const account = computeFinalAccount({
      ...base,
      measuredLines: [],
      approvedVariationNetDeltas: ['10000', '-2000'],
      issuedRequestsTotal: '136400',
    });
    // 12,400 - 2,480
    expect(account.variationsCharge).toBe('9920.0000');
    expect(account.finalValue).toBe('133920.0000');
    expect(account.balance).toBe('-2480.0000');
  });

  it('the balance is the final value minus everything billed so far', () => {
    const account = computeFinalAccount({ ...base, approvedVariationNetDeltas: ['10000'], issuedRequestsTotal: '136400' });
    // 124,000 + 12,400 + 4,960
    expect(account.finalValue).toBe('141360.0000');
    expect(account.billedSoFar).toBe('136400.0000');
    expect(account.balance).toBe('4960.0000');
  });

  it('a provisional line measured under its quantity lowers the final account', () => {
    const short = line({ lineId: 'p', qty: '200', unitPrice: '100', provisional: true, measuredQty: '180' });
    const account = computeFinalAccount({ ...base, measuredLines: [short] });
    expect(account.billedLines).toEqual([{ lineId: 'p', residualQty: '-20.0000', works: '-2000.0000' }]);
    expect(account.adjustmentCharge).toBe('-2480.0000');
    expect(account.balance).toBe('-2480.0000');
  });

  it('prices the residual at the line discount, then the document discount', () => {
    const discounted = line({
      lineId: 'p', qty: '10', unitPrice: '100', discountPct: '10', provisional: true, measuredQty: '20',
    });
    const account = computeFinalAccount({ ...base, discountPct: '5', measuredLines: [discounted] });
    // 10 x 100 = 1,000 less 10% = 900 on the line; less 5% on the document = 855
    expect(account.billedLines[0].works).toBe('900.0000');
    expect(account.adjustmentWorks).toBe('855.0000');
    // 855 + 119.7 VAT + 85.5 supervision
    expect(account.adjustmentCharge).toBe('1060.2000');
  });

  it('a provisional line measured exactly as contracted adds nothing', () => {
    const exact = line({ lineId: 'p', qty: '200', unitPrice: '100', provisional: true, measuredQty: '200' });
    const account = computeFinalAccount({ ...base, measuredLines: [exact] });
    expect(account.billedLines).toEqual([]);
    expect(account.balance).toBe('0.0000');
  });
});

describe('billingBalance', () => {
  // R4: 124,000; a provisional line of 1,000 at 100 read at 100 mid-job; 62,000 issued.
  const midJob: FinalAccountInput = {
    ...base,
    measuredLines: [line({ lineId: 'p', qty: '1000', unitPrice: '100', provisional: true, measuredQty: '100' })],
    issuedRequestsTotal: '62000',
  };

  it('leaves measured residuals out: contract plus change orders minus issued requests', () => {
    expect(billingBalance(midJob)).toBe('62000.0000');
    expect(billingBalance({ ...midJob, approvedVariationNetDeltas: ['10000'] })).toBe('74400.0000');
  });

  it('the full final account still counts the same residual', () => {
    const account = computeFinalAccount(midJob);
    // -900 x 100 = -90,000 works; with VAT and supervision -111,600
    expect(account.billedLines).toEqual([{ lineId: 'p', residualQty: '-900.0000', works: '-90000.0000' }]);
    expect(account.adjustmentCharge).toBe('-111600.0000');
    expect(account.balance).toBe('-49600.0000');
  });
});

describe('finalAccountBalance (the card reads the measured works summed in SQL, R3)', () => {
  it('equals computeFinalAccount for the same lines, from their works summed', () => {
    const lines = [
      provisional,
      firmCovered,
      firmUncovered,
      line({ lineId: 'p2', qty: '12.3500', unitPrice: '87.5000', discountPct: '12.5', provisional: true, measuredQty: '9.1111' }),
    ];
    const input: FinalAccountInput = { ...base, discountPct: '2.5', approvedVariationNetDeltas: ['10000', '-333.3333'], measuredLines: lines };
    const account = computeFinalAccount(input);
    const works = account.billedLines.reduce((total, billed) => total + Number(billed.works) * 10000, 0) / 10000;
    expect(finalAccountBalance(input, works.toFixed(4))).toBe(account.balance);
    expect(billingBalance(input)).toBe(finalAccountBalance(input, '0'));
  });
});
