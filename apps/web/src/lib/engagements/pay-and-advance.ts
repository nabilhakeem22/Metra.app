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
import { recordPaymentCore } from './payments';
import type { Trigger } from './transitions';

export interface LogPaymentAndAdvanceInput {
  paymentKind: PaymentEventKind;
  /** Scale-4 money string — validated + canonicalised by recordPaymentCore. */
  amount: string;
  method?: string | null;
  reference?: string | null;
  advanceTrigger: Trigger;
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
  const recorded = await recordPaymentCore(ctx, {
    engagementId,
    kind: input.paymentKind,
    amount: input.amount,
    method: input.method ?? null,
    reference: input.reference ?? null,
  });
  if (!recorded.ok) return { ...recorded, paymentRecorded: false };

  const advanced = await executeTransition(ctx, {
    engagementId,
    trigger: input.advanceTrigger,
  });
  return { ...advanced, paymentRecorded: true };
}
