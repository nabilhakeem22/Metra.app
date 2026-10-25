// PURE and client-safe. ONE status per delivery, read by the deliveries list,
// the dashboard panel and the delivery header, so the three can never disagree.
// It layers time over A1's whose-move rule: a delivery the client has held for
// a week or more is called out as stalled. The studio's own move is never
// "stalled", however old: it stays paired with the one action that clears it.
//
// ONE EXCEPTION, AT `execution`: the delivery header reads the execution phase
// (executionDeliveryStatus below) from the execution facts only its own page
// loads. The list and the dashboard do not load them, so they still call an
// execution delivery delivered (lists by phase are a later step of the plan).
import type { Actor, StepLocation } from '@/lib/flow/types';
import type { StatusTone } from '@/lib/ui/status-tone';
import { daysSince, isStale } from './delivery-age';
import type { DesignState } from './states';
import type { WhoseMove } from './whose-move';

export type DeliveryStatus =
  | { kind: 'yourMove' }
  | { kind: 'confirmPayment' }
  /** `days` is null when the wait has no start the product holds (the execution phase). */
  | { kind: 'waitingClient'; days: number | null }
  | { kind: 'stalled'; days: number }
  | { kind: 'delivered' }
  | { kind: 'abandoned' }
  /** The execution contract was terminated: the job closed without being delivered (the header at `execution` only). */
  | { kind: 'terminated' };

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

/** Who holds the execution move, as the header says it. The site team is the studio's own people. */
const EXECUTION_ACTOR_STATUS: Readonly<Record<Actor, DeliveryStatus>> = {
  studio: { kind: 'yourMove' },
  site: { kind: 'yourMove' },
  client: { kind: 'waitingClient', days: null },
};

/**
 * The status of a delivery at `execution`, from where its execution phase is
 * (lib/flow/locate/execution-studio.ts): whose move it is while the works run,
 * delivered once settled, terminated once the contract was (closed, never
 * delivered). The client's wait is not aged, so never stalled: the delivery
 * row's `updatedAt` does not move with the contract, and counting from it would
 * date the wrong thing.
 */
export function executionDeliveryStatus(location: StepLocation): DeliveryStatus {
  if (location.status === 'closed') return { kind: 'terminated' };
  if (location.status === 'complete' || location.whoseMove === null) return { kind: 'delivered' };
  return EXECUTION_ACTOR_STATUS[location.whoseMove];
}

const KIND_TONE: Record<DeliveryStatusKind, StatusTone> = {
  yourMove: 'yourMove',
  confirmPayment: 'yourMove',
  waitingClient: 'waiting',
  stalled: 'stalled',
  delivered: 'done',
  abandoned: 'neutral',
  terminated: 'neutral',
};

export function deliveryStatusTone(status: DeliveryStatus): StatusTone {
  return KIND_TONE[status.kind];
}
