import { describe, expect, it } from 'vitest';
import * as rules from './no-email-notice';
import { designMoveIsClientPayment, executionNoEmailAct } from './no-email-notice';

// H5: the cockpit's no-email notice shows only while the client holds the
// move AND that move needs a code: a payment ("I paid") or, since H6.2, the
// contract to sign while its window is open (H6.3 A5, AC11).

describe('designMoveIsClientPayment', () => {
  it('a fee instalment the client still owes, waiting on the client: yes', () => {
    for (const guard of ['depositCleared', 'gateAInstallmentCleared', 'gateBInstallmentCleared', 'balanceCleared'] as const) {
      expect(designMoveIsClientPayment({ mode: 'blockedClient', blockingGuards: [guard] })).toBe(true);
    }
    expect(designMoveIsClientPayment({ mode: 'blockedClient', blockingGuards: ['handoffAcknowledged', 'balanceCleared'] })).toBe(true);
  });

  it('the client\'s move is not a payment, or the studio holds the move: no', () => {
    expect(designMoveIsClientPayment({ mode: 'blockedClient', blockingGuards: ['handoffAcknowledged'] })).toBe(false);
    expect(designMoveIsClientPayment({ mode: 'blockedClient', blockingGuards: [] })).toBe(false);
    expect(designMoveIsClientPayment({ mode: 'blockedStudio', blockingGuards: ['depositCleared'] })).toBe(false);
    expect(designMoveIsClientPayment({ mode: 'ready', blockingGuards: [] })).toBe(false);
    expect(designMoveIsClientPayment({ mode: 'closed', blockingGuards: [] })).toBe(false);
  });
});

describe('executionNoEmailAct', () => {
  it("the client's payment or signature; the studio's move (a closed signing window too), another step or none: null", () => {
    expect(executionNoEmailAct({ kind: 'record_payment' }, 'client')).toBe('payment');
    expect(executionNoEmailAct({ kind: 'record_signed_offline' }, 'client')).toBe('signature');
    expect(executionNoEmailAct({ kind: 'record_signed_offline' }, 'studio')).toBeNull();
    expect(executionNoEmailAct({ kind: 'record_payment' }, 'studio')).toBeNull();
    expect(executionNoEmailAct({ kind: 'send_contract' }, 'client')).toBeNull();
    expect(executionNoEmailAct({ kind: 'constructor' }, 'client')).toBeNull();
    expect(executionNoEmailAct(null, null)).toBeNull();
  });

  it('replaces the payment-only rule', () => {
    expect('executionMoveIsClientPayment' in rules).toBe(false);
  });
});
