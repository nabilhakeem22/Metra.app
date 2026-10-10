'use server';

import { acknowledgeBudgetAndNotify } from '@/lib/engagements/client-acts/budget-acts';
import { chooseConceptAndNotify, respondToConceptAndNotify } from '@/lib/engagements/client-acts/concept-acts';
import { approveDesignWithBudgetAndNotify, respondToDesignAndNotify } from '@/lib/engagements/client-acts/design-acts';
import { acknowledgeHandoverAndNotify } from '@/lib/engagements/client-acts/handover-acts';
import { clientNote } from '@/lib/engagements/client-note';
import { isConceptVerb, type ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import { isDesignVerb, type DesignOutcome, type HandoverOutcome } from '@/lib/engagements/review-outcome';
import type { DeliveryActResult } from './actions';
import { requestProvenance } from './request-provenance';

// The client's REVIEW acts on the portal: the concept, the final design, the
// budget range and the handover. Public (no session): the share token IS the
// authorization, flows straight to the act modules, which hash it, and is
// NEVER logged here. Each act captures the client's IP and user agent
// (./request-provenance.ts) for the append-only engagement_events trail, and an
// invisible note is no note (clientNote). Every answer names only a decision
// that is SAVED (../../../lib/engagements/review-outcome.ts): a repeat reports
// the decision on file, never the verb just tapped. A verb outside an act's
// own pair is refused here: a server action is directly invokable.

/** Choose one concept option, by the letter the client saw (1 = A). */
export async function chooseDeliveryConcept(
  token: string,
  artifactId: string,
  position: number,
  note?: string,
): Promise<ConceptChoiceOutcome> {
  return chooseConceptAndNotify(token, { artifactId, position, note: clientNote(note), ...(await requestProvenance()) });
}

/** Approve the concept or ask for changes to it. */
export async function respondToDeliveryConcept(token: string, verb: string, note?: string): Promise<ConceptChoiceOutcome> {
  if (!isConceptVerb(verb)) return { kind: 'error', error: 'generic' };
  return respondToConceptAndNotify(token, { action: verb, note: clientNote(note), ...(await requestProvenance()) });
}

/** Approve the final design or ask for changes to it. */
export async function respondToDeliveryDesign(token: string, verb: string, note?: string): Promise<DesignOutcome> {
  if (!isDesignVerb(verb)) return { kind: 'error', error: 'generic' };
  return respondToDesignAndNotify(token, { action: verb, note: clientNote(note), ...(await requestProvenance()) });
}

/** Approve the final design and acknowledge the budget range, from one confirmation. */
export async function approveDesignWithBudget(token: string, note?: string): Promise<DesignOutcome> {
  return approveDesignWithBudgetAndNotify(token, { note: clientNote(note), ...(await requestProvenance()) });
}

/** Acknowledge the budget range issued now (the budget card's own button). */
export async function acknowledgeDeliveryBudget(token: string): Promise<DeliveryActResult> {
  return acknowledgeBudgetAndNotify(token, await requestProvenance());
}

/** Confirm receiving the design package. */
export async function acknowledgeDeliveryHandover(token: string, note?: string): Promise<HandoverOutcome> {
  return acknowledgeHandoverAndNotify(token, { note: clientNote(note), ...(await requestProvenance()) });
}
