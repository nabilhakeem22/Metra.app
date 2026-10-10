// Which server action an actionable hero's button sends, and how its answer
// reads. One typed action per review act (./review-actions.ts); a verb outside
// the hero's groups sends nothing.
import { isConceptVerb } from '@/lib/engagements/concept-choice-outcome';
import { isDesignVerb } from '@/lib/engagements/review-outcome';
import {
  acknowledgeDeliveryHandover,
  approveDesignWithBudget,
  respondToDeliveryConcept,
  respondToDeliveryDesign,
} from '../review-actions';
import {
  answerOfConceptOutcome,
  answerOfDesignOutcome,
  answerOfHandoverOutcome,
  type HeroAnswer,
} from './hero-answer';

/**
 * Send one hero verb and read the answer. `withBudget`: the final approval also
 * acknowledges the budget range offered alongside it (one confirmation).
 */
export async function sendHeroVerb(
  token: string,
  verb: string,
  note: string,
  { withBudget }: { withBudget: boolean },
): Promise<HeroAnswer> {
  if (isConceptVerb(verb)) return answerOfConceptOutcome(await respondToDeliveryConcept(token, verb, note));
  if (verb === 'approve_design' && withBudget) return answerOfDesignOutcome(await approveDesignWithBudget(token, note));
  if (isDesignVerb(verb)) return answerOfDesignOutcome(await respondToDeliveryDesign(token, verb, note));
  if (verb === 'acknowledge_handoff') return answerOfHandoverOutcome(await acknowledgeDeliveryHandover(token, note));
  return { error: 'generic', refresh: false };
}
