import 'server-only';
// Client Delivery Portal Phase 3 — the STUDIO side of client payment claims. A
// session-less client "mark as paid" appended a `pending` client_payment_claims row
// (via the cost-blind token SDF); here the studio RESOLVES it from the cockpit:
//   - confirmPaymentClaimCore: record the REAL payment (one payment_events row,
//     append-only ledger) AND flip the claim to `confirmed` — atomically, in ONE tx.
//   - dismissPaymentClaimCore: flip the claim to `dismissed`, no ledger row.
// Both are gated on `engagements_finance`; both verify the claim resolves in-org
// (RLS scopes the read) so a caller can never resolve a foreign org's claim. Money
// is validated with exact scale-4 BigInt (never parseFloat) — the studio may EDIT
// the amount at confirm time, so it is re-validated here, not trusted from the claim.
import { clientPaymentClaims } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { invariant } from '@/lib/actions/invariant';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { recordClaimPayment } from './payment-claim-ledger';
import { assertClaimStillPayable, lockClaimForConfirm, markClaimConfirmed } from './payment-claim-rows';
import { readPaymentAmount } from './payment-field-rules';

export interface ConfirmPaymentClaimInput {
  claimId: string;
  /** The studio-confirmed amount (pre-filled with the claimed amount, EDITABLE). */
  amount: string;
}

/**
 * Confirm a pending client payment claim: record the real payment and flip the
 * claim to `confirmed`, in ONE transaction. Gated on `engagements_finance` create.
 * Flow: validate a well-formed positive scale-4 `amount` (else a coded error); open
 * the RLS tx; ROW-LOCK the claim (`SELECT ... FOR UPDATE`) so a concurrent
 * confirm/dismiss serializes on the row BEFORE any money is written; resolve status
 * (`claim_not_found` if absent/foreign/dismissed; an ALREADY-confirmed claim is an
 * idempotent no-op returning its existing payment id with `already: true`, no second
 * row); lock the engagement row and assert it is not terminal (`engagement_not_active`,
 * mirroring recordPaymentCore) and that the milestone still has money outstanding
 * (`claim_already_settled` when it was already paid in full) BEFORE inserting; INSERT one `payment_events` row (kind = the
 * claim's milestone, `recorded_by = ctx.userId`, `idempotency_key = 'claim:<claimId>'`); then
 * UPDATE the claim -> confirmed guarded on status='pending' with `.returning()` — if
 * it matches 0 rows the row changed under us, so THROW to roll back the payment
 * insert too (belt and suspenders on top of the row lock). Returns the payment id in
 * `data`. Never throws to the client — coded ActionResult only.
 */
export async function confirmPaymentClaimCore(
  ctx: OrgContext,
  input: ConfirmPaymentClaimInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  // The canonical scale-4 value is persisted, so the STORED amount is exactly the
  // one the app validated (the DB numeric would otherwise round a >4-decimal input).
  const typed = readPaymentAmount(input.amount);
  if (!typed.ok) return fieldsFailed({ amount: typed.error });
  const amount = typed.value;

  let already = false;

  const result = await mutateInOrg(
    ctx,
    { capability: 'engagements_finance', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const claim = await lockClaimForConfirm(tx, input.claimId);
      // Absent or foreign (RLS-filtered to empty) -> not resolvable.
      if (!claim) fail('claim_not_found');
      if (claim.status === 'confirmed') {
        // Idempotent: already confirmed. A confirmed claim MUST carry its payment
        // ref — a NULL is a data-integrity error, never a '' money sentinel.
        invariant(claim.confirmedPaymentEventId, 'confirmed claim without its payment event');
        already = true;
        return claim.confirmedPaymentEventId;
      }
      // Dismissed (or any non-pending) -> not resolvable.
      if (claim.status !== 'pending') fail('claim_not_found');

      await assertClaimStillPayable(tx, claim);
      const recorded = await recordClaimPayment(tx, ctx, { claim, amount }, audit);
      if (recorded.adopted) already = true;
      await markClaimConfirmed(tx, ctx, claim, recorded.paymentId);
      return recorded.paymentId;
    },
  );

  return result.ok ? { ...result, already } : result;
}

export interface DismissPaymentClaimInput {
  claimId: string;
}

/**
 * Dismiss a pending client payment claim: flip it to `dismissed` with the resolver
 * stamp, writing NO payment row. Gated on `engagements_finance` update. ROW-LOCKS the
 * claim (`SELECT ... FOR UPDATE`) so a concurrent confirm/dismiss serializes on the
 * row and the two can't both "win"; `claim_not_found` if absent/foreign/not-pending.
 * The status flip is then guarded on status='pending' with `.returning()` — a 0-row
 * result means the row changed under the lock, so THROW to roll back. After a dismiss
 * the partial-unique slot frees, so the client may re-submit a fresh claim for that
 * milestone. Never throws to the client — coded ActionResult only.
 */
export async function dismissPaymentClaimCore(
  ctx: OrgContext,
  input: DismissPaymentClaimInput,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'engagements_finance', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      // Row-lock first so a concurrent confirm can't slip a payment in between our
      // read and write (it will block here, then re-read the committed status).
      const [claim] = await tx
        .select({
          id: clientPaymentClaims.id,
          engagementId: clientPaymentClaims.engagementId,
          status: clientPaymentClaims.status,
        })
        .from(clientPaymentClaims)
        .where(eq(clientPaymentClaims.id, input.claimId))
        .for('update')
        .limit(1);
      // Absent, foreign (RLS-filtered), or already resolved -> not dismissable.
      if (!claim || claim.status !== 'pending') fail('claim_not_found');

      const updated = await tx
        .update(clientPaymentClaims)
        .set({
          status: 'dismissed',
          resolvedBy: ctx.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clientPaymentClaims.id, claim.id),
            eq(clientPaymentClaims.status, 'pending'),
          ),
        )
        .returning({ id: clientPaymentClaims.id });
      // Under the row lock this always matches; a 0-row result means the row changed
      // under us -> THROW so the tx rolls back (never a silent no-op).
      if (updated.length === 0) fail('claim_not_found');

      await audit({
        entity: 'design_engagement',
        entityId: claim.engagementId,
        action: 'update',
        before: null,
        after: { claim_id: claim.id, status: 'dismissed' },
      });
    },
  );
}
