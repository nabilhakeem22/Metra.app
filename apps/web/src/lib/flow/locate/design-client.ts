// Where a delivery is in the DESIGN phase, for the client. PURE and CLIENT-SAFE.
// It reads the delivery page's own facts (`PublicDelivery`): the step is the
// journey milestone (lib/engagements/journey-map.ts), and the move is the
// client's when the page's hero asks them to act OR when the studio waits on
// their design fee instalment at a gate (deposit, Gate A, Gate B, balance),
// the same wait the studio's rail shows as the client's.
import type { MilestoneKind } from '@metra/db';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from '@/lib/engagements/guards/trigger-money-gate';
import { JOURNEY_MILESTONES, type JourneyMilestoneKey } from '@/lib/engagements/journey-map';
import { PORTAL_STAGE_KEY, type PortalStageKey } from '@/lib/engagements/portal-stage';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { TRANSITIONS, type Trigger } from '@/lib/engagements/transitions';
import type { StepLocation } from '../types';

/** The delivery page facts this locator reads. */
export type ClientDesignFacts = Pick<PublicDelivery, 'milestone' | 'stageKey' | 'hero' | 'paymentSchedule' | 'paymentClaim'>;

const LAST_MILESTONE: JourneyMilestoneKey = JOURNEY_MILESTONES[JOURNEY_MILESTONES.length - 1];

/**
 * The instalment each client stage's way forward waits on, read off the machine:
 * a trigger leaving the stage's state behind a money gate. Derived, so a gate
 * moved in the transition table moves here too.
 */
const STAGE_GATE_FEE: ReadonlyMap<PortalStageKey, MilestoneKind> = new Map(
  (Object.keys(TRANSITIONS) as Trigger[]).flatMap((trigger) => {
    const guard = moneyGuardOf(trigger);
    const fee = guard && MONEY_GUARD_MILESTONE[guard];
    if (!fee) return [];
    return [TRANSITIONS[trigger].from].flat().map((state) => [PORTAL_STAGE_KEY[state], fee] as const);
  }),
);

/**
 * The client owes the instalment their stage's gate waits on: it is in the
 * schedule (a schedule without it is a free gate), not fully paid, and carries
 * no claim the studio has yet to confirm (then the studio holds the move).
 */
function owesGateFee(delivery: ClientDesignFacts): boolean {
  const fee = STAGE_GATE_FEE.get(delivery.stageKey);
  if (!fee) return false;
  const instalment = delivery.paymentSchedule.find((row) => row.milestone_kind === fee);
  if (!instalment || instalment.status === 'paid') return false;
  const claimed = delivery.paymentClaim?.claimableMilestones.some((row) => row.milestoneKind === fee && row.hasPendingClaim);
  return !claimed;
}

export function locateDesignForClient(delivery: ClientDesignFacts): StepLocation<JourneyMilestoneKey> {
  const { milestone } = delivery;
  if (milestone.closed) return { step: null, whoseMove: null, status: 'closed' };
  if (milestone.allComplete) return { step: LAST_MILESTONE, whoseMove: null, status: 'complete' };
  const step = JOURNEY_MILESTONES[milestone.index];
  if (step === undefined) throw new Error('milestone index is not a journey milestone');
  return {
    step,
    whoseMove: delivery.hero.kind === 'action' || owesGateFee(delivery) ? 'client' : 'studio',
    status: 'active',
  };
}
