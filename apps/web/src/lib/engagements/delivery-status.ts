// PURE and client-safe. ONE status per delivery, read by the deliveries list,
// the dashboard panel and the delivery header, so the three can never disagree.
// It layers time over A1's whose-move rule: a delivery the client has held for
// a week or more is called out as stalled. The studio's own move is never
// "stalled", however old: it stays paired with the one action that clears it.
import type { StatusTone } from '@/lib/ui/status-tone';
import { daysSince, isStale } from './delivery-age';
import type { DesignState } from './states';
import type { WhoseMove } from './whose-move';

export type DeliveryStatus =
  | { kind: 'yourMove' }
  | { kind: 'confirmPayment' }
  | { kind: 'waitingClient'; days: number }
  | { kind: 'stalled'; days: number }
  | { kind: 'delivered' }
  | { kind: 'abandoned' };

export type DeliveryStatusKind = DeliveryStatus['kind'];

export interface DeliveryStatusInput {
  state: DesignState;
  whoseMove: WhoseMove;
  daysSinceChange: number;
}

export function resolveDeliveryStatus(input: DeliveryStatusInput): DeliveryStatus {
  if (input.state === 'abandoned') return { kind: 'abandoned' };
  // Both endings are a finished delivery, told the same way.
  if (input.state === 'execution' || input.state === 'closed_design_only') {
    return { kind: 'delivered' };
  }
  switch (input.whoseMove) {
    case 'closed':
      return { kind: 'delivered' };
    case 'confirmPayment':
      return { kind: 'confirmPayment' };
    case 'studio':
      return { kind: 'yourMove' };
    case 'client':
      return isStale(input.daysSinceChange)
        ? { kind: 'stalled', days: input.daysSinceChange }
        : { kind: 'waitingClient', days: input.daysSinceChange };
  }
}

/**
 * The status of a delivery as of `now`, counting days from its last change
 * (`updatedAt`, the same instant the list, the dashboard and the page read).
 */
export function deliveryStatusAsOf(
  delivery: { state: DesignState; whoseMove: WhoseMove; updatedAt: string },
  now: Date,
): DeliveryStatus {
  return resolveDeliveryStatus({
    state: delivery.state,
    whoseMove: delivery.whoseMove,
    daysSinceChange: daysSince(delivery.updatedAt, now),
  });
}

const KIND_TONE: Record<DeliveryStatusKind, StatusTone> = {
  yourMove: 'yourMove',
  confirmPayment: 'yourMove',
  waitingClient: 'waiting',
  stalled: 'stalled',
  delivered: 'done',
  abandoned: 'neutral',
};

export function deliveryStatusTone(status: DeliveryStatus): StatusTone {
  return KIND_TONE[status.kind];
}
