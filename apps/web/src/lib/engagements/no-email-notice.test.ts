import { describe, expect, it } from 'vitest';
import * as rules from './no-email-notice';
import { designMoveIsClientPayment, executionNoEmailAct } from './no-email-notice';

// H5: the cockpit's no-email notice shows only while the client holds the
// move AND that move needs a code: a payment ("I paid") or, since H6.2, the
// contract to sign while its window is open (H6.3 A5, AC11). H7 F3: a change
// order waiting on the client with a live link shows it whatever the next action.

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
    expect(executionNoEmailAct({ kind: 'record_payment' }, 'client', 0)).toBe('payment');
    expect(executionNoEmailAct({ kind: 'record_signed_offline' }, 'client', 0)).toBe('signature');
    expect(executionNoEmailAct({ kind: 'record_signed_offline' }, 'studio', 0)).toBeNull();
    expect(executionNoEmailAct({ kind: 'record_payment' }, 'studio', 0)).toBeNull();
    expect(executionNoEmailAct({ kind: 'send_contract' }, 'client', 0)).toBeNull();
    expect(executionNoEmailAct({ kind: 'constructor' }, 'client', 0)).toBeNull();
    expect(executionNoEmailAct(null, null, 0)).toBeNull();
  });

  it('a change order with a live link: the decision, whatever the next action and whoever holds it (F3)', () => {
    expect(executionNoEmailAct({ kind: 'await_variation_answer' }, 'client', 1)).toBe('decision');
    for (const kind of ['send_milestone_request', 'send_variation_request', 'review_payment_claim', 'review_final_account', 'await_variation_answer']) {
      expect(executionNoEmailAct({ kind }, 'studio', 2)).toBe('decision');
    }
  });

  it('a payment and a signature keep their priority over a live change order (F3)', () => {
    expect(executionNoEmailAct({ kind: 'record_payment' }, 'client', 3)).toBe('payment');
    expect(executionNoEmailAct({ kind: 'record_signed_offline' }, 'client', 3)).toBe('signature');
  });

  it('a lapsed order counts for nothing: no notice on it alone (F3)', () => {
    expect(executionNoEmailAct({ kind: 'await_variation_answer' }, 'studio', 0)).toBeNull();
    expect(executionNoEmailAct({ kind: 'send_milestone_request' }, 'studio', 0)).toBeNull();
  });

  it('a contract with no next action or no holder blocks nothing, whatever the count says (F3)', () => {
    expect(executionNoEmailAct(null, null, 1)).toBeNull();
    expect(executionNoEmailAct({ kind: 'open_boq' }, null, 1)).toBeNull();
  });

  it('replaces the payment-only rule', () => {
    expect('executionMoveIsClientPayment' in rules).toBe(false);
  });
});
