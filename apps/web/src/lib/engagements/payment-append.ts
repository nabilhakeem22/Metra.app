import 'server-only';
// Stage 2 of recording a payment: the two ways ONE row reaches the append-only
// ledger, and the audit entry a NEW row writes. Nothing here validates anything —
// `payment-input.ts` has already done that — and nothing here opens or commits a
// transaction: the caller's `tx` is used and nothing else.
import { paymentEvents } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import type { mutateInOrg } from '@/lib/actions/mutate';
import type { OrgContext } from '@/lib/db/context';
import type { CleanPayment } from './payment-input';

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];
type Audit = Parameters<Parameters<typeof mutateInOrg>[2]>[1];

/** The audit entry a NEW row writes. A replay writes NONE, which is the point. */
export function auditPayment(
  audit: Audit,
  engagementId: string,
  paymentId: string,
  clean: CleanPayment,
): Promise<void> {
  return audit({
    entity: 'design_engagement',
    entityId: engagementId,
    action: 'create',
    before: null,
    after: { payment_id: paymentId, kind: clean.kind, amount: clean.amount },
  });
}

/**
 * KEYED PATH — dedup via the partial unique arbiter (first-write-wins).
 *
 * ON CONFLICT DO NOTHING (not a raised unique violation) so the surrounding
 * `withOrgContext` transaction is never aborted — the codebase's established
 * idempotency idiom (mirrors claimPeriod). This preserves append-only: never an
 * UPDATE, so a replay keeps the ORIGINAL amount.
 *
 * `already: true` is what the caller turns into the studio-facing "that payment
 * was already recorded". It means the LEDGER WAS NOT APPENDED.
 */
export async function appendKeyedPayment(
  tx: Tx,
  ctx: OrgContext,
  engagementId: string,
  clean: CleanPayment,
  idempotencyKey: string,
): Promise<{ id: string; already: boolean }> {
  const inserted = await tx
    .insert(paymentEvents)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind: clean.kind,
      amount: clean.amount,
      method: clean.method,
      reference: clean.reference,
      recordedBy: ctx.userId,
      note: clean.note,
      idempotencyKey,
    })
    .onConflictDoNothing({
      // For onConflictDoNothing, `where` is the ARBITER predicate — it renders
      // `ON CONFLICT (org_id, engagement_id, idempotency_key) WHERE
      // idempotency_key is not null DO NOTHING`, matching the partial unique
      // index exactly (targetWhere is a doUpdate-only option).
      target: [
        paymentEvents.orgId,
        paymentEvents.engagementId,
        paymentEvents.idempotencyKey,
      ],
      where: sql`idempotency_key is not null`,
    })
    .returning({ id: paymentEvents.id });

  if (inserted.length > 0) return { id: inserted[0].id, already: false };

  // Lost the race / replay: return the winning row's id, no second audit.
  const [existing] = await tx
    .select({ id: paymentEvents.id })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.orgId, ctx.orgId),
        eq(paymentEvents.engagementId, engagementId),
        eq(paymentEvents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return { id: existing.id, already: true };
}

/** KEYLESS PATH — byte-identical to the original plain append. */
export async function appendPayment(
  tx: Tx,
  ctx: OrgContext,
  engagementId: string,
  clean: CleanPayment,
): Promise<string> {
  const [row] = await tx
    .insert(paymentEvents)
    .values({
      orgId: ctx.orgId,
      engagementId,
      kind: clean.kind,
      amount: clean.amount,
      method: clean.method,
      reference: clean.reference,
      recordedBy: ctx.userId,
      note: clean.note,
    })
    .returning({ id: paymentEvents.id });
  return row.id;
}
