// When the cockpit says "the client has no email on file, so they cannot do
// this online" (H5, the notice H2 D2 deferred until codes exist). PURE and
// CLIENT-SAFE. The client acts that need a one-time code are "I paid", signing
// the execution contract (H6.2) and deciding a change order (H7.1), so the
// notice shows only while the CLIENT holds the move and that move is one of
// them: a design-fee instalment the client still owes, a payment request of the
// execution contract, or the contract to sign while its signing window is open.
// A change order waiting on the client with a live link needs that same code,
// whatever else the studio's next action is, so it shows the notice too unless
// a payment or a signature already does. Never on a lapsed order, and never
// where it would say something not yet true.
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

/** The client act a missing email blocks, as the notice words it. */
export type NoEmailAct = 'payment' | 'signature' | 'decision';

/** The execution moves the client makes with a code, by the studio's next action they stand behind. */
const EXECUTION_CLIENT_MOVES: ReadonlyMap<string, NoEmailAct> = new Map<string, NoEmailAct>([
  ['record_payment', 'payment'],
  ['record_signed_offline', 'signature'],
]);

/**
 * Execution phase: the client act the missing email blocks right now, or null.
 * The studio's next action is the paper signature both while the client may
 * still sign online and once the window has closed; only the first is the
 * client's move (the other is the studio's, F4), so only then does a missing
 * email block it. A change order is not told from the next action, which can be
 * a milestone request while one waits: `liveOrderCount` counts the orders issued
 * to the client whose link is live, so a lapsed one never counts. A contract with
 * no next action or no holder (settled, terminated) blocks nothing.
 */
export function executionNoEmailAct(next: { kind: string } | null, whoseMove: string | null, liveOrderCount: number): NoEmailAct | null {
  if (next === null || whoseMove === null) return null;
  const clientMove = whoseMove === 'client' ? EXECUTION_CLIENT_MOVES.get(next.kind) : undefined;
  return clientMove ?? (liveOrderCount > 0 ? 'decision' : null);
}
