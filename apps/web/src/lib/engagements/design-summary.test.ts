import { describe, expect, it } from 'vitest';
import { designSummary } from './design-summary';
import type { EngagementFeeSchedule, EngagementPayment } from './queries';

// deposit 72,000 by amount; gate_a 20% and gate_b 20% of the fee; balance 36,000 (fee 180,000).
const SCHEDULE: EngagementFeeSchedule = {
  designFee: '180000.0000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '72000.0000', sortOrder: 0 },
    { kind: 'gate_a', basis: 'percent', value: '20.0000', sortOrder: 1 },
    { kind: 'gate_b', basis: 'percent', value: '20.0000', sortOrder: 2 },
    { kind: 'balance', basis: 'amount', value: '36000.0000', sortOrder: 3 },
  ],
};

function paid(kind: EngagementPayment['kind'], amount: string): EngagementPayment {
  return {
    id: `p-${kind}-${amount}`,
    kind,
    amount,
    method: null,
    reference: null,
    clearedAt: new Date('2026-09-01T00:00:00Z'),
    note: null,
    idempotencyKey: null,
  };
}

const ALL_PAID = [paid('deposit', '72000.0000'), paid('gate_a', '36000.0000'), paid('gate_b', '36000.0000'), paid('balance', '36000.0000')];
const NOTHING_ELSE = { paymentClaims: [], awaitingReplyCount: 0 };

describe('designSummary', () => {
  it('a fully paid design has nothing open', () => {
    expect(designSummary({ feeSchedule: SCHEDULE, payments: ALL_PAID, ...NOTHING_ELSE })).toEqual({
      openInstalments: 0,
      pendingClaims: 0,
      awaitingReply: 0,
    });
  });

  it('counts exactly the instalments the ledger falls short of, the percent ones by the fee', () => {
    const payments = [paid('deposit', '72000.0000'), paid('gate_a', '35999.9900'), paid('gate_b', '36000.0000')];
    expect(designSummary({ feeSchedule: SCHEDULE, payments, ...NOTHING_ELSE }).openInstalments).toBe(2);
  });

  it('adds part-payments of one instalment up before judging it', () => {
    const payments = [...ALL_PAID.filter((payment) => payment.kind !== 'balance'), paid('balance', '20000.0000'), paid('balance', '16000.0000')];
    expect(designSummary({ feeSchedule: SCHEDULE, payments, ...NOTHING_ELSE }).openInstalments).toBe(0);
  });

  it('a revision change-order receipt clears no instalment', () => {
    const payments = [...ALL_PAID.filter((payment) => payment.kind !== 'balance'), paid('revision_co', '36000.0000')];
    expect(designSummary({ feeSchedule: SCHEDULE, payments, ...NOTHING_ELSE }).openInstalments).toBe(1);
  });

  it('a scheduled instalment with no design fee to compute it from is open, as the guards hold it', () => {
    const feeSchedule = { ...SCHEDULE, designFee: null };
    expect(designSummary({ feeSchedule, payments: ALL_PAID, ...NOTHING_ELSE }).openInstalments).toBe(4);
  });

  it('carries the pending claims and the unanswered questions as counted', () => {
    expect(
      designSummary({ feeSchedule: SCHEDULE, payments: ALL_PAID, paymentClaims: [{ id: 'c-1' }, { id: 'c-2' }], awaitingReplyCount: 3 }),
    ).toEqual({ openInstalments: 0, pendingClaims: 2, awaitingReply: 3 });
  });
});
