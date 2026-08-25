// Design-Engagement Machine — the Hero's "Log payment & advance" core (Epic D,
// Slice 3). SEQUENTIAL and money-safe: record the cleared payment, then (only if
// that succeeded) fire the forward-advance trigger. Both steps delegate to the
// already-reviewed cores (`recordPaymentCore` + `executeTransition`), so every
// gate they enforce — the `engagements_finance`/design capability, the
// `flow:'interior'` entitlement, and terminal-state rejection — still applies; this
// core adds NO new authority. The payment genuinely persists even when step 2's
// guard still blocks (e.g. a short amount): that is acceptable, the next gate
// preview re-checks and shows the remaining shortfall. Kept as a pure
// `*Core(ctx,input)` (API-ready) so its thin server-action wrapper only resolves
// the org context + revalidates.
import type { PaymentEventKind } from '@metra/db';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { executeTransition } from './executor';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from './guards';
import { recordPaymentCore } from './payments';
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
 */
export type LogPaymentAndAdvanceResult = ActionResult & {
  paymentRecorded: boolean;
};

/**
 * Record a cleared payment, then advance. If the payment core fails, its coded
 * error is returned UNCHANGED and the transition is never attempted
 * (`paymentRecorded: false`). Otherwise the transition result is returned — ok, or
 * the (re-checked) guard error — with `paymentRecorded: true`. Never throws.
 */
export async function logPaymentAndAdvanceCore(
  ctx: OrgContext,
  engagementId: string,
  input: LogPaymentAndAdvanceInput,
): Promise<LogPaymentAndAdvanceResult> {
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

  // Falls through even on an idempotent hit (`recorded.already`): the guard
  // re-checks and the advance is a no-op (or the still-valid forward move) — the
  // machine converges on retry.
  const advanced = await executeTransition(ctx, {
    engagementId,
    trigger: input.advanceTrigger,
  });
  return { ...advanced, paymentRecorded: true };
}
