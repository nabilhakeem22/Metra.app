import 'server-only';
// The deliveries an automation core reasons about (Round C, C4): every in-flight
// one, with the SAME status the deliveries list, the dashboard and the delivery
// page show (whose move, then time: lib/engagements/delivery-status.ts), and the
// instant the client's current wait began. Read inside the runner's org
// transaction, as the system actor's role, once per org per tick (org-tick-memo.ts).
import {
  clientPaymentClaims,
  designEngagements,
  engagementEvents,
  engagementTransitions,
  type MetraDb,
} from '@metra/db';
import { and, desc, eq, max, ne, notInArray, sql } from 'drizzle-orm';
import { daysSince } from '@/lib/engagements/delivery-age';
import { deliveryStatusAsOf, type DeliveryStatus } from '@/lib/engagements/delivery-status';
import { loadWhoseMovesInTx } from '@/lib/engagements/queries/whose-move';
import { TERMINAL_STATES } from '@/lib/engagements/states';
import type { WhoseMove } from '@/lib/engagements/whose-move';
import type { MemberRole } from '@/lib/permissions/roles';

/**
 * A safety bound, not a pool: five times the dashboard's triage pool. Whose move
 * is decided by the guard facts in TypeScript (loadWhoseMovesInTx, a constant
 * number of reads for any count), so every in-flight delivery is read; only past
 * this many are the most dormant (oldest `updated_at`) left out, and logged.
 */
export const IN_FLIGHT_LIMIT = 1000;

export interface InFlightDelivery {
  id: string;
  number: number;
  createdAt: Date;
  titleAr: string | null;
  titleEn: string | null;
  updatedAt: Date;
  whoseMove: WhoseMove;
  /** The shared status (list, dashboard, page): its days count from `updatedAt`. */
  status: DeliveryStatus;
  /**
   * When the current wait began: the last state move or round start, or the
   * studio's last act that handed the move back to the client (the band issued,
   * a client decision retracted, a payment claim dismissed). Unlike `updatedAt`,
   * a link rotation, a visibility toggle or a client comment does not move it.
   */
  waitingSince: Date;
}

export interface DeliveryCounts {
  yourMove: number;
  waitingOnClient: number;
  stalled: number;
}

/** Per delivery: the newest instant of each kind of act `waitingSince` counts from. */
function newestActsPerDelivery(tx: MetraDb) {
  const moved = tx
    .select({ engagementId: engagementTransitions.engagementId, at: max(engagementTransitions.decidedAt).as('moved_at') })
    .from(engagementTransitions)
    .groupBy(engagementTransitions.engagementId)
    .as('moved');
  const retracted = tx
    .select({ engagementId: engagementEvents.engagementId, at: max(engagementEvents.decidedAt).as('retracted_at') })
    .from(engagementEvents)
    .where(and(eq(engagementEvents.kind, 'event_correction'), ne(engagementEvents.actorChannel, 'client')))
    .groupBy(engagementEvents.engagementId)
    .as('retracted');
  const dismissed = tx
    .select({ engagementId: clientPaymentClaims.engagementId, at: max(clientPaymentClaims.resolvedAt).as('dismissed_at') })
    .from(clientPaymentClaims)
    .where(eq(clientPaymentClaims.status, 'dismissed'))
    .groupBy(clientPaymentClaims.engagementId)
    .as('dismissed');
  return { moved, retracted, dismissed };
}

/**
 * Every non-terminal delivery (up to {@link IN_FLIGHT_LIMIT}, newest first),
 * each with its whose-move, the shared status as of `now`, and `waitingSince`.
 */
export async function inFlightDeliveries(
  tx: MetraDb,
  role: MemberRole,
  now: Date,
): Promise<{ deliveries: InFlightDelivery[]; capped: boolean }> {
  const { moved, retracted, dismissed } = newestActsPerDelivery(tx);
  const waitingSinceMs = sql<number>`(extract(epoch from greatest(
      ${designEngagements.createdAt}, ${designEngagements.romIssuedAt}, ${designEngagements.rendersReadyAt},
      ${moved.at}, ${retracted.at}, ${dismissed.at})) * 1000)::float8`.mapWith(Number);
  const rows = await tx
    .select({
      id: designEngagements.id,
      number: designEngagements.number,
      createdAt: designEngagements.createdAt,
      titleAr: designEngagements.titleAr,
      titleEn: designEngagements.titleEn,
      updatedAt: designEngagements.updatedAt,
      state: designEngagements.state,
      waitingSinceMs,
    })
    .from(designEngagements)
    .leftJoin(moved, eq(moved.engagementId, designEngagements.id))
    .leftJoin(retracted, eq(retracted.engagementId, designEngagements.id))
    .leftJoin(dismissed, eq(dismissed.engagementId, designEngagements.id))
    .where(notInArray(designEngagements.state, [...TERMINAL_STATES]))
    .orderBy(desc(designEngagements.updatedAt))
    .limit(IN_FLIGHT_LIMIT + 1);
  const pool = rows.slice(0, IN_FLIGHT_LIMIT);
  const moves = await loadWhoseMovesInTx(tx, role, pool);
  const deliveries = pool.map(({ state, waitingSinceMs: since, ...row }) => {
    const whoseMove = moves.get(row.id) ?? 'studio';
    const status = deliveryStatusAsOf({ state, whoseMove, updatedAt: row.updatedAt.toISOString() }, now);
    return { ...row, whoseMove, status, waitingSince: new Date(since) };
  });
  return { deliveries, capped: rows.length > IN_FLIGHT_LIMIT };
}

/** Whole days the client has held this delivery, from `waitingSince` (the list's floor rule). */
export function daysWaiting(delivery: Pick<InFlightDelivery, 'waitingSince'>, now: Date): number {
  return daysSince(delivery.waitingSince.toISOString(), now);
}

/** PURE: how many are the studio's move (a payment to confirm counts), waiting, or stalled. */
export function deliveryCounts(deliveries: readonly Pick<InFlightDelivery, 'status'>[]): DeliveryCounts {
  const counts: DeliveryCounts = { yourMove: 0, waitingOnClient: 0, stalled: 0 };
  for (const { status } of deliveries) {
    if (status.kind === 'yourMove' || status.kind === 'confirmPayment') counts.yourMove += 1;
    else if (status.kind === 'waitingClient') counts.waitingOnClient += 1;
    else if (status.kind === 'stalled') counts.stalled += 1;
  }
  return counts;
}
