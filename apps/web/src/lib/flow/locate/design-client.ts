// Where a delivery is in the DESIGN phase, for the client. PURE and CLIENT-SAFE.
// The step is the journey milestone the delivery page already carries
// (`PublicDelivery.milestone`, from lib/engagements/journey-map.ts); the move is
// the client's exactly when the page's hero asks them to act.
import { JOURNEY_MILESTONES, type JourneyMilestoneKey, type MilestoneProgress } from '@/lib/engagements/journey-map';
import type { HeroKind } from '@/lib/engagements/portal-hero';
import type { StepLocation } from '../types';

const LAST_MILESTONE: JourneyMilestoneKey = JOURNEY_MILESTONES[JOURNEY_MILESTONES.length - 1];

export function locateDesignForClient(milestone: MilestoneProgress, heroKind: HeroKind): StepLocation<JourneyMilestoneKey> {
  if (milestone.closed) return { step: null, whoseMove: null, status: 'closed' };
  if (milestone.allComplete) return { step: LAST_MILESTONE, whoseMove: null, status: 'complete' };
  return {
    step: JOURNEY_MILESTONES[milestone.index],
    whoseMove: heroKind === 'action' ? 'client' : 'studio',
    status: 'active',
  };
}
