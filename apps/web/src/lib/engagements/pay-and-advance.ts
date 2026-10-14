// Design-Engagement Machine — the Hero's "Log payment & advance" core (Epic D,
// Slice 3). SEQUENTIAL and money-safe: record the cleared payment, then (only if
// that succeeded) fire the forward-advance trigger. Both steps delegate to the
// already-reviewed cores (`recordPaymentCore` + `executeTransition`), so every
// gate they enforce — the `engagements_finance`/design capability, the
// `flow:'interior'` entitlement, and terminal-state rejection — still applies; this
// core adds NO new authority. The payment genuinely persists even when step 2's
// guard still blocks (e.g. a short amount): that is acceptable, the answer is
// still `ok` (the money is saved) with the guard as `waitingOn`, and the next
// gate preview shows the remaining shortfall. Kept as a pure
// `*Core(ctx,input)` (API-ready) so its thin server-action wrapper only resolves
// the org context + revalidates.
import type { PaymentEventKind } from '@metra/db';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { OrgContext } from '@/lib/db/context';
import { executeTransition } from './executor';
import { isEndingTrigger } from './forward-trigger';
import { getEngagementGatePreview } from './gate-preview';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from './guards';
import { recordPaymentCore } from './payments';
import { isDefiniteRefusal } from './retry-policy';
import type { Trigger } from './transitions';

export interface LogPaymentAndAdvanceInput {
  paymentKind: PaymentEventKind;
  /** Scale-4 money string — validated + canonicalised by recordPaymentCore. */
  amount: string;
  method?: string | null;
  reference?: string | null;
  advanceTrigger: Trigger;
  /**
   * Optional client-supplied idempotency key (UUID) — threaded to
   * recordPaymentCore so a double-submit records ONE payment. A replay still
   * re-runs `executeTransition` (the guard re-checks; the advance is a no-op if
   * already made).
   */
  idempotencyKey?: string | null;
}

/**
 * The final step's result, plus whether the payment actually persisted — so the
 * action wrapper can revalidate the engagement path even when the advance guard
 * still blocks (the ledger changed and the checklist must refresh).
 *
 * `ActionResult.already` on this result means THE PAYMENT was a replay of a key
 * the ledger already carried, not that the transition was: `paymentRecorded`
 * says a row exists, `already` says it is not a new one.
 */
export type LogPaymentAndAdvanceResult = ActionResult & {
  paymentRecorded: boolean;
  /** Recorded, not advanced: why the stage waits (the client's review, a guard
   *  still unmet, or `advance_unconfirmed` when the advance gave no answer). */
  waitingOn?: ActionCode;
};

/**
 * Record a cleared payment, then advance. If the payment core fails, its coded
 * error is returned UNCHANGED and the transition is never attempted
 * (`paymentRecorded: false`). Otherwise the answer is `ok` with
 * `paymentRecorded: true`, and `waitingOn` says why the stage did not move when
 * it did not. Never throws.
 */
export async function logPaymentAndAdvanceCore(
  ctx: OrgContext,
  engagementId: string,
  input: LogPaymentAndAdvanceInput,
): Promise<LogPaymentAndAdvanceResult> {
  // An ENDING is the studio's explicit choice, never the side effect of logging
  // a payment. Refused before anything is written.
  if (isEndingTrigger(input.advanceTrigger)) {
    return { ok: false, error: 'ending_requires_explicit_choice', paymentRecorded: false };
  }
  // The advance trigger must be a money gate, and the recorded payment's kind
  // must match the milestone that gate clears — else this combined action would
  // append a payment of the wrong kind (which never counts toward the guard) and
  // then fail the advance, leaving an orphaned receipt. Reject BEFORE recording,
  // with no row written.
  const moneyGuard = moneyGuardOf(input.advanceTrigger);
  const expectedKind = moneyGuard ? MONEY_GUARD_MILESTONE[moneyGuard] : undefined;
  if (!expectedKind || input.paymentKind !== expectedKind) {
    return { ok: false, error: 'payment_kind_mismatch', paymentRecorded: false };
  }

  const recorded = await recordPaymentCore(ctx, {
    engagementId,
    kind: input.paymentKind,
    amount: input.amount,
    method: input.method ?? null,
    reference: input.reference ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
  if (!recorded.ok) return { ...recorded, paymentRecorded: false };

  // FROM HERE THE PAYMENT IS IN THE LEDGER, so every answer is `ok`: the form
  // closes and the studio reads "payment recorded" plus why the stage did not
  // move (`waitingOn`). A refusal here used to travel as a definite refusal,
  // which released the held key with the form still open and the amount still
  // typed, so the next Save recorded the payment a second time (R1).
  const already = recorded.already === true;
  const stands = { ok: true, already, paymentRecorded: true } as const;

  // Never past a review the client has not answered, whatever card sent this:
  // the payment stands, the delivery waits for the client (or for an approval
  // the studio records as taken offline), as confirm-claim-and-advance does.
  try {
    if ((await getEngagementGatePreview(ctx, engagementId)).awaitingClientReview) {
      return { ...stands, waitingOn: 'client_review_pending' };
    }
  } catch (error) {
    console.error('logPaymentAndAdvance review read failed:', loggableFailure(error));
    return { ...stands, waitingOn: 'advance_unconfirmed' };
  }

  // Runs even on an idempotent hit (`recorded.already`): the guard re-checks
  // and the machine converges on retry. `already` IS THE PAYMENT'S and is
  // carried out deliberately (`executeTransition` never sets it), so both money
  // controls can say no second row was written.
  const advanced = await executeTransition(ctx, {
    engagementId,
    trigger: input.advanceTrigger,
  });
  return { ...stands, ...advanceOutcome(advanced, already) };
}

/**
 * What the advance after a recorded payment says next to it. A replay whose
 * trigger no longer applies is the first attempt's advance, already made: it
 * is a success, not "this step is not allowed". A definite refusal is the
 * reason the stage waits; anything else could not be confirmed either way.
 */
function advanceOutcome(advanced: ActionResult, already: boolean): { waitingOn?: ActionCode } {
  if (advanced.ok || (already && advanced.error === 'illegal_trigger')) return {};
  return { waitingOn: isDefiniteRefusal(advanced.error) ? advanced.error : 'advance_unconfirmed' };
}
