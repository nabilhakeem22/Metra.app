import { describe, expect, it } from 'vitest';
import { derivePaymentsOverview, paymentClaimState } from './portal-payments';
import type { PublicDelivery, PublicDeliveryMilestone } from './public/types';

function milestone(
  milestone_kind: string,
  amount_due: string,
  amount_cleared: string,
  status: PublicDeliveryMilestone['status'],
): PublicDeliveryMilestone {
  return { milestone_kind, basis: 'amount', amount_due, amount_cleared, status };
}

/** The approved mockup's "midway" schedule: deposit paid, gate_b partly paid. */
const MIDWAY = [
  milestone('deposit', '36000.0000', '36000.0000', 'paid'),
  milestone('gate_b', '48000.0000', '20000.0000', 'partial'),
  milestone('balance', '36000.0000', '0.0000', 'due'),
];

describe('derivePaymentsOverview', () => {
  it('returns null for an empty or absent schedule (the card renders nothing)', () => {
    expect(derivePaymentsOverview([])).toBeNull();
    expect(derivePaymentsOverview(null)).toBeNull();
    expect(derivePaymentsOverview(undefined)).toBeNull();
  });

  it('totals amount_due and amount_cleared in exact scale-4', () => {
    const overview = derivePaymentsOverview(MIDWAY);
    expect(overview?.total).toBe('120000.0000');
    expect(overview?.paid).toBe('56000.0000');
    expect(overview?.percentPaid).toBe(46);
  });

  it('never drifts the way float addition does', () => {
    const overview = derivePaymentsOverview([
      milestone('deposit', '0.1000', '0.1000', 'paid'),
      milestone('balance', '0.2000', '0.2000', 'paid'),
    ]);
    expect(overview?.total).toBe('0.3000');
    expect(overview?.paid).toBe('0.3000');
  });

  it('marks the first unsettled milestone as next, in schedule order', () => {
    const overview = derivePaymentsOverview(MIDWAY);
    expect(overview?.next?.milestoneKind).toBe('gate_b');
    expect(overview?.rows.map((row) => row.isNext)).toEqual([false, true, false]);
  });

  it('gives each row its state: paid, partial, later', () => {
    const overview = derivePaymentsOverview(MIDWAY);
    expect(overview?.rows.map((row) => row.state)).toEqual(['paid', 'partial', 'later']);
  });

  it('reads an untouched next milestone as due', () => {
    const overview = derivePaymentsOverview([
      milestone('deposit', '1000.0000', '1000.0000', 'paid'),
      milestone('gate_a', '500.0000', '0.0000', 'due'),
      milestone('balance', '500.0000', '0.0000', 'due'),
    ]);
    expect(overview?.rows.map((row) => row.state)).toEqual(['paid', 'due', 'later']);
  });

  it('computes the partial amounts: cleared, due and what remains', () => {
    const gateB = derivePaymentsOverview(MIDWAY)?.rows[1];
    expect(gateB?.amountCleared).toBe('20000.0000');
    expect(gateB?.amountDue).toBe('48000.0000');
    expect(gateB?.amountRemaining).toBe('28000.0000');
  });

  it('never reports a negative remaining on an over-cleared row', () => {
    const overview = derivePaymentsOverview([
      milestone('deposit', '100.0000', '150.0000', 'paid'),
    ]);
    expect(overview?.rows[0].amountRemaining).toBe('0.0000');
    expect(overview?.percentPaid).toBe(100);
  });

  it('is all-settled with no next milestone and a full bar when every row is paid', () => {
    const overview = derivePaymentsOverview([
      milestone('deposit', '36000.0000', '36000.0000', 'paid'),
      milestone('balance', '84000.0000', '84000.0000', 'paid'),
    ]);
    expect(overview?.allSettled).toBe(true);
    expect(overview?.next).toBeNull();
    expect(overview?.percentPaid).toBe(100);
    expect(overview?.rows.every((row) => row.state === 'paid')).toBe(true);
  });

  it('is not settled while any milestone is unpaid, and an empty total reads 0%', () => {
    const overview = derivePaymentsOverview([milestone('deposit', '0', '0', 'due')]);
    expect(overview?.allSettled).toBe(false);
    expect(overview?.percentPaid).toBe(0);
  });
});

describe('paymentClaimState', () => {
  const claim: PublicDelivery['paymentClaim'] = {
    claimableMilestones: [
      { milestoneKind: 'gate_b', amountRemaining: '28000.0000', hasPendingClaim: false },
      { milestoneKind: 'balance', amountRemaining: '36000.0000', hasPendingClaim: true },
    ],
  };
  const none = new Set<string>();

  it('is claimable with the server-locked remaining amount', () => {
    expect(paymentClaimState(claim, 'gate_b', none)).toEqual({
      kind: 'claimable',
      amountRemaining: '28000.0000',
    });
  });

  it('is pending when an open claim awaits the studio', () => {
    expect(paymentClaimState(claim, 'balance', none)).toEqual({ kind: 'pending' });
  });

  it('is pending once the client claimed it in this session', () => {
    expect(paymentClaimState(claim, 'gate_b', new Set(['gate_b']))).toEqual({ kind: 'pending' });
  });

  it('is none for a milestone the SDF did not list, or with no claim object', () => {
    expect(paymentClaimState(claim, 'deposit', none)).toEqual({ kind: 'none' });
    expect(paymentClaimState(null, 'gate_b', none)).toEqual({ kind: 'none' });
  });
});
