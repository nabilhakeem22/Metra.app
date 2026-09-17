import 'server-only';
import {
  designEngagements,
  engagementChangeOrders,
  engagementMilestones,
  paymentEvents,
  type ChangeOrderStatus,
  type MilestoneBasis,
  type MilestoneKind,
  type PaymentEventKind,
} from '@metra/db';
import { asc, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** A single milestone in a fee schedule (money as a scale-4 string). */
export interface FeeScheduleMilestone {
  kind: MilestoneKind;
  basis: MilestoneBasis;
  value: string;
  sortOrder: number;
}

/**
 * The fee schedule for an engagement: the design fee plus its ordered milestones.
 * `designFee` is null until `submitDesignFee` has fired. All money is returned as
 * scale-4 strings — the API/UI layer applies 2-decimal formatting, not this query.
 * RLS scopes both reads to the caller's org (a foreign engagement reads as empty).
 */
export interface EngagementFeeSchedule {
  designFee: string | null;
  milestones: FeeScheduleMilestone[];
}

export function getEngagementFeeSchedule(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementFeeSchedule> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({ designFee: designEngagements.designFee })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    const milestones = await tx
      .select({
        kind: engagementMilestones.kind,
        basis: engagementMilestones.basis,
        value: engagementMilestones.value,
        sortOrder: engagementMilestones.sortOrder,
      })
      .from(engagementMilestones)
      .where(eq(engagementMilestones.engagementId, engagementId))
      .orderBy(asc(engagementMilestones.sortOrder));

    return { designFee: engagement?.designFee ?? null, milestones };
  });
}

/**
 * The rough build-cost band (ROM) set on an engagement. Both values are scale-4
 * strings or null (unset until `setEngagementRom` has fired). The API/UI layer
 * applies 2-decimal formatting, not this query. RLS scopes the read to the
 * caller's org (a foreign engagement reads as `{ romLow: null, romHigh: null }`).
 */
export interface EngagementRom {
  romLow: string | null;
  romHigh: string | null;
}

export function getEngagementRom(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementRom> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({
        romLow: designEngagements.romLow,
        romHigh: designEngagements.romHigh,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    return {
      romLow: engagement?.romLow ?? null,
      romHigh: engagement?.romHigh ?? null,
    };
  });
}

/** One row of the append-only payment ledger (money as a scale-4 string). */
export interface EngagementPayment {
  id: string;
  kind: PaymentEventKind;
  amount: string;
  method: string | null;
  reference: string | null;
  clearedAt: Date;
  note: string | null;
  /**
   * The key the cockpit sent with the attempt that recorded this payment (NULL
   * for a plain append and for anything written before 0050). Selected because
   * the cockpit answers a question with it: a key it still holds for a payment
   * it was never told the outcome of has LANDED iff a row here carries it — and
   * a payment writes no transition row, so nothing else could say so. An opaque
   * UUID this client minted; never rendered. See `landedKeysOf`.
   */
  idempotencyKey: string | null;
}

/**
 * The cleared payments recorded against an engagement, NEWEST FIRST. All money is
 * returned as scale-4 strings — the API/UI layer applies 2-decimal formatting,
 * not this query. RLS scopes the read to the caller's org (a foreign engagement
 * reads as an empty list).
 */
export function getEngagementPayments(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementPayment[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: paymentEvents.id,
        kind: paymentEvents.kind,
        amount: paymentEvents.amount,
        method: paymentEvents.method,
        reference: paymentEvents.reference,
        clearedAt: paymentEvents.clearedAt,
        note: paymentEvents.note,
        idempotencyKey: paymentEvents.idempotencyKey,
      })
      .from(paymentEvents)
      .where(eq(paymentEvents.engagementId, engagementId))
      .orderBy(desc(paymentEvents.clearedAt), desc(paymentEvents.createdAt)),
  );
}

/** One design-fee change order raised on an engagement (money as scale-4 string). */
export interface EngagementChangeOrderRecord {
  id: string;
  amount: string;
  reason: string | null;
  status: ChangeOrderStatus;
  raisedByUserId: string;
  raisedAt: Date;
  settledAt: Date | null;
}

/**
 * The change orders raised against an engagement, NEWEST FIRST. `amount` is a
 * scale-4 string — the API/UI layer applies 2-decimal formatting, not this query.
 * RLS scopes the read to the caller's org (a foreign engagement reads as an empty
 * list).
 */
export function getEngagementChangeOrders(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementChangeOrderRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementChangeOrders.id,
        amount: engagementChangeOrders.amount,
        reason: engagementChangeOrders.reason,
        status: engagementChangeOrders.status,
        raisedByUserId: engagementChangeOrders.raisedByUserId,
        raisedAt: engagementChangeOrders.raisedAt,
        settledAt: engagementChangeOrders.settledAt,
      })
      .from(engagementChangeOrders)
      .where(eq(engagementChangeOrders.engagementId, engagementId))
      .orderBy(
        desc(engagementChangeOrders.raisedAt),
        desc(engagementChangeOrders.createdAt),
      ),
  );
}
