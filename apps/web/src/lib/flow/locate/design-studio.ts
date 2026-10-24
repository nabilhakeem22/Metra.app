// Where a delivery is in the DESIGN phase, for the studio. PURE and CLIENT-SAFE.
// The step and the gate are the stage spine's (lib/engagements/stage-spine.ts);
// whose move it is comes from the delivery status the header chip, the
// deliveries list and the dashboard already say, so the rail never disagrees
// with them.
import type { DeliveryStatus, DeliveryStatusKind } from '@/lib/engagements/delivery-status';
import { spinePosition, spineStageKeyOf, type SpineStageKey } from '@/lib/engagements/stage-spine';
import { DESIGN_STATES, type DesignState } from '@/lib/engagements/states';
import { assertOneOf, entryOf } from '../assert';
import type { Actor, StepLocation } from '../types';

/** Total over the status kinds, so a new kind does not compile until it names an actor. */
const STATUS_ACTOR: Readonly<Record<DeliveryStatusKind, Actor | null>> = {
  yourMove: 'studio',
  confirmPayment: 'studio',
  waitingClient: 'client',
  stalled: 'client',
  delivered: null,
  abandoned: null,
};

export function locateDesignForStudio(state: DesignState, deliveryStatus: DeliveryStatus): StepLocation<SpineStageKey> {
  assertOneOf(DESIGN_STATES, state, 'design state');
  const whoseMove = entryOf(STATUS_ACTOR, deliveryStatus.kind, 'delivery status');
  const position = spinePosition(state);
  if (position.closed) return { step: null, whoseMove: null, status: 'closed' };
  if (position.allComplete) return { step: spineStageKeyOf(state), whoseMove: null, status: 'complete' };
  return {
    step: spineStageKeyOf(state),
    whoseMove,
    status: 'active',
    ...(position.atGate ? { atGate: position.atGate } : {}),
  };
}
