// Which server action an actionable hero's button sends, and how its answer
// reads. One typed action per review act (./review-actions.ts), one per verb a
// hero button can carry (./hero-buttons.ts).
import { isConceptVerb } from '@/lib/engagements/concept-choice-outcome';
import { isDesignVerb } from '@/lib/engagements/review-outcome';
import type { ReviewSeen } from '@/lib/engagements/review-seen';
import {
  acknowledgeDeliveryHandover,
  approveDesignWithBudget,
  respondToDeliveryConcept,
  respondToDeliveryDesign,
} from '../review-actions';
import {
  answerOfConceptOutcome,
  answerOfDesignOutcome,
  answerOfDesignWithBudgetOutcome,
  answerOfHandoverOutcome,
  type HeroAnswer,
} from './hero-answer';
import type { HeroVerb } from './hero-buttons';

/**
 * Send one hero verb and read the answer. `withBudget`: the final approval also
 * acknowledges the budget range offered alongside it (one confirmation, two
 * consents). `seen`: the issuances the hero showed (the render round, the
 * band), which the database checks under its row lock.
 */
export async function sendHeroVerb(
  token: string,
  verb: HeroVerb,
  note: string,
  { withBudget, seen }: { withBudget: boolean; seen: ReviewSeen },
): Promise<HeroAnswer> {
  if (isConceptVerb(verb)) return answerOfConceptOutcome(await respondToDeliveryConcept(token, verb, note));
  if (verb === 'approve_design' && withBudget) {
    return answerOfDesignWithBudgetOutcome(await approveDesignWithBudget(token, note, seen));
  }
  if (isDesignVerb(verb)) return answerOfDesignOutcome(await respondToDeliveryDesign(token, verb, note, seen));
  return answerOfHandoverOutcome(await acknowledgeDeliveryHandover(token, note));
}
