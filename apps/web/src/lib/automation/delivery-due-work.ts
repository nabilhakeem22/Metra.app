import 'server-only';
// The deliveries an automation core reasons about (Round C, C4): the in-flight
// ones with the SAME status the deliveries list, the dashboard and the delivery
// page show (whose move, then time: lib/engagements/delivery-status.ts). Read
// inside the runner's org transaction, as the system actor's role.
import { designEngagements, type MetraDb } from '@metra/db';
import { asc, notInArray } from 'drizzle-orm';
import { deliveryStatusAsOf, type DeliveryStatus } from '@/lib/engagements/delivery-status';
import { loadWhoseMovesInTx } from '@/lib/engagements/queries/whose-move';
import { TERMINAL_STATES } from '@/lib/engagements/states';
import type { MemberRole } from '@/lib/permissions/roles';

/** In-flight deliveries read per org (the dashboard's triage pool, A12). */
export const IN_FLIGHT_POOL = 200;

export interface InFlightDelivery {
  id: string;
  number: number;
  createdAt: Date;
  titleAr: string | null;
  titleEn: string | null;
  updatedAt: Date;
  status: DeliveryStatus;
}

export interface DeliveryCounts {
  yourMove: number;
  waitingOnClient: number;
  stalled: number;
}

/**
 * Up to {@link IN_FLIGHT_POOL} non-terminal deliveries, OLDEST `updated_at`
 * first, each with the shared status rule as of `now`. `capped` says the org has
 * more (the newest are then not considered).
 */
export async function inFlightDeliveries(
  tx: MetraDb,
  role: MemberRole,
  now: Date,
): Promise<{ deliveries: InFlightDelivery[]; capped: boolean }> {
  const rows = await tx
    .select({
      id: designEngagements.id,
      number: designEngagements.number,
      createdAt: designEngagements.createdAt,
      titleAr: designEngagements.titleAr,
      titleEn: designEngagements.titleEn,
      updatedAt: designEngagements.updatedAt,
      state: designEngagements.state,
    })
    .from(designEngagements)
    .where(notInArray(designEngagements.state, [...TERMINAL_STATES]))
    .orderBy(asc(designEngagements.updatedAt))
    .limit(IN_FLIGHT_POOL + 1);
  const pool = rows.slice(0, IN_FLIGHT_POOL);
  const moves = await loadWhoseMovesInTx(tx, role, pool);
  const deliveries = pool.map(({ state, ...row }) => ({
    ...row,
    status: deliveryStatusAsOf(
      { state, whoseMove: moves.get(row.id) ?? 'studio', updatedAt: row.updatedAt.toISOString() },
      now,
    ),
  }));
  return { deliveries, capped: rows.length > IN_FLIGHT_POOL };
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
