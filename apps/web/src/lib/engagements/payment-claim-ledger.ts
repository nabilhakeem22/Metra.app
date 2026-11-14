import 'server-only';
// The ledger phase of confirming a client payment claim, inside the confirm's own
// transaction: one payment_events row keyed by the claim, or the adoption of the
// row a raced or replayed confirm already wrote.
import { paymentEvents, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { invariant } from '@/lib/actions/invariant';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import type { LockedClaim } from './payment-claim-rows';

type ClaimPaymentTarget = Pick<LockedClaim, 'id' | 'engagementId' | 'milestoneKind'>;

interface ClaimPaymentEntry {
  claim: ClaimPaymentTarget;
  claimKey: string;
  amount: string;
}

export interface RecordedClaimPayment {
  paymentId: string;
  /** A raced or replayed confirm adopted the first-written row. */
  adopted: boolean;
}

/** The claim's payment row, inserted unless its key is already taken (then no row comes back). */
async function insertClaimPayment(
  tx: MetraDb,
  ctx: OrgContext,
  entry: ClaimPaymentEntry,
): Promise<{ id: string }[]> {
  const { claim, claimKey, amount } = entry;
  const inserted = await tx
    .insert(paymentEvents)
    .values({
      orgId: ctx.orgId,
      engagementId: claim.engagementId,
      kind: claim.milestoneKind,
      amount,
      recordedBy: ctx.userId,
      idempotencyKey: claimKey,
    })
    .onConflictDoNothing({
      target: [
        paymentEvents.orgId,
        paymentEvents.engagementId,
        paymentEvents.idempotencyKey,
      ],
      where: sql`idempotency_key is not null`,
    })
    .returning({ id: paymentEvents.id });
  return inserted;
}

/** The id of the payment already written under the claim's key, checked against this confirmation. */
async function adoptRacedClaimPayment(
  tx: MetraDb,
  ctx: OrgContext,
  entry: ClaimPaymentEntry,
): Promise<string> {
  // Lost the idempotency race / replay: return the winning row's id, with no
  // second audit (mirrors recordPaymentCore). recordClaimPayment reports it as
  // `adopted`, and the core answers `already: true`. The winner is re-read and
  // CHECKED: adopting a row whose kind or amount differs from what this
  // confirmation is for would resolve the claim against the wrong money, so a
  // mismatch aborts the whole transaction instead.
  const { claim, claimKey, amount } = entry;
  const [existing] = await tx
    .select({
      id: paymentEvents.id,
      kind: paymentEvents.kind,
      amount: paymentEvents.amount,
    })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.orgId, ctx.orgId),
        eq(paymentEvents.engagementId, claim.engagementId),
        eq(paymentEvents.idempotencyKey, claimKey),
      ),
    )
    .limit(1);
  if (
    !existing ||
    existing.kind !== claim.milestoneKind ||
    parseMoney4(existing.amount) !== parseMoney4(amount)
  ) {
    invariant(false, 'claim payment event does not match the claim');
  }
  return existing.id;
}

/** Records the confirmed money once: a fresh row with its audit entry, or the adopted one with none. */
export async function recordClaimPayment(
  tx: MetraDb,
  ctx: OrgContext,
  confirmation: { claim: ClaimPaymentTarget; amount: string },
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<RecordedClaimPayment> {
  const { claim, amount } = confirmation;
  // Record the real payment, keyed so a raced / replayed confirm dedups to
  // the first-written payment (no second ledger row).
  //
  // The key is NAMESPACED, not the bare claim id: recordPaymentCore accepts a
  // caller-supplied idempotency key but requires it to be a UUID, so a bare
  // claim id was forgeable. Anyone who knew a pending claim's id could
  // pre-insert a 1.00 EGP payment under that key, and this insert would then
  // conflict and adopt it — confirming the client's claim against a payment of
  // the attacker's choosing. `claim:<uuid>` is not a UUID, so recordPaymentCore
  // can never mint a row in this namespace.
  const claimKey = `claim:${claim.id}`;
  const inserted = await insertClaimPayment(tx, ctx, { claim, claimKey, amount });
  if (inserted.length > 0) {
    const paymentId = inserted[0].id;
    await audit({
      entity: 'design_engagement',
      entityId: claim.engagementId,
      action: 'create',
      before: null,
      after: {
        payment_id: paymentId,
        kind: claim.milestoneKind,
        amount,
        claim_id: claim.id,
      },
    });
    return { paymentId, adopted: false };
  }
  return { paymentId: await adoptRacedClaimPayment(tx, ctx, { claim, claimKey, amount }), adopted: true };
}
