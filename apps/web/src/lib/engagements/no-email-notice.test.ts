import { describe, expect, it } from 'vitest';
import { designMoveIsClientPayment, executionMoveIsClientPayment } from './no-email-notice';

// H5: the cockpit's no-email notice shows only while the client holds the
// move AND that move is a payment ("I paid" is the one act that needs a code
// in this build).

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

describe('executionMoveIsClientPayment', () => {
  it('a payment the client owes on the contract: yes; anything else, or the studio\'s move: no', () => {
    expect(executionMoveIsClientPayment({ kind: 'record_payment' }, 'client')).toBe(true);
    expect(executionMoveIsClientPayment({ kind: 'record_payment' }, 'studio')).toBe(false);
    expect(executionMoveIsClientPayment({ kind: 'record_signed_offline' }, 'client')).toBe(false);
    expect(executionMoveIsClientPayment(null, null)).toBe(false);
  });
});
