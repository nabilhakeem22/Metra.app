// When the cockpit says "the client has no email on file, so they cannot
// report a payment online" (H5, the notice H2 D2 deferred until codes exist).
// PURE and CLIENT-SAFE. In this build the one client act that needs a one-time
// code is "I paid" (signing and change-order decisions follow in H6 and H7),
// so the notice shows only while the CLIENT holds the move and that move is a
// payment: a design-fee instalment the client still owes, or a payment request
// of the execution contract. Never while the move is anything else, where it
// would say something not yet true.
import type { CommandCardView } from './command-card';
import type { GuardKey } from './guards';

/** The design-fee gates the client clears by paying (and saying so with a code). */
const CLIENT_PAYMENT_GUARDS: ReadonlySet<GuardKey> = new Set<GuardKey>([
  'depositCleared',
  'gateAInstallmentCleared',
  'gateBInstallmentCleared',
  'balanceCleared',
]);

/** Design phase: the client holds the move, and what it waits on includes a fee instalment. */
export function designMoveIsClientPayment(view: Pick<CommandCardView, 'mode' | 'blockingGuards'>): boolean {
  return view.mode === 'blockedClient' && view.blockingGuards.some((guard) => CLIENT_PAYMENT_GUARDS.has(guard));
}

/** Execution phase: the client holds the move, and the next act is a payment on the contract. */
export function executionMoveIsClientPayment(next: { kind: string } | null, whoseMove: string | null): boolean {
  return whoseMove === 'client' && next?.kind === 'record_payment';
}
