'use server';

import { acknowledgeSeenBudgetAndNotify } from '@/lib/engagements/client-acts/budget-acts';
import { chooseConceptAndNotify, respondToConceptAndNotify } from '@/lib/engagements/client-acts/concept-acts';
import { approveDesignWithBudgetAndNotify, respondToDesignAndNotify } from '@/lib/engagements/client-acts/design-acts';
import { acknowledgeHandoverAndNotify } from '@/lib/engagements/client-acts/handover-acts';
import { clientNote } from '@/lib/engagements/client-note';
import { isConceptVerb, type ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import {
  isDesignVerb,
  type BudgetOutcome,
  type DesignOutcome,
  type HandoverOutcome,
} from '@/lib/engagements/review-outcome';
import { parseBandSeen, parseReviewSeen } from '@/lib/engagements/review-seen';
import { PORTAL_ACT_THROTTLE } from '@/lib/share/token-throttle';
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
//
// WHAT WAS SEEN (fix round F1/F2): the design and budget acts carry the
// fingerprint of what the client's dialog showed (the render round, the band;
// ../../../lib/engagements/review-seen.ts). A missing or malformed one (an old
// page during a deploy, a forged call) reads "changed": nothing is written and
// the page re-reads.
//
// A LIGHT BRAKE (S2): 30 review acts a minute per link, per Worker isolate
// (../../../lib/share/token-throttle.ts); past it an act answers the generic
// "something went wrong, try again" and writes nothing.

const THROTTLED = { kind: 'error', error: 'generic' } as const;

/** Choose one concept option, by the letter the client saw (1 = A). */
export async function chooseDeliveryConcept(
  token: string,
  artifactId: string,
  position: number,
  note?: string,
): Promise<ConceptChoiceOutcome> {
  if (!PORTAL_ACT_THROTTLE.allow(token)) return THROTTLED;
  return chooseConceptAndNotify(token, { artifactId, position, note: clientNote(note), ...(await requestProvenance()) });
}

/** Approve the concept or ask for changes to it. */
export async function respondToDeliveryConcept(token: string, verb: string, note?: string): Promise<ConceptChoiceOutcome> {
  if (!PORTAL_ACT_THROTTLE.allow(token)) return THROTTLED;
  if (!isConceptVerb(verb)) return { kind: 'error', error: 'generic' };
  return respondToConceptAndNotify(token, { action: verb, note: clientNote(note), ...(await requestProvenance()) });
}

/** Approve the final design or ask for changes to it, about the round the client saw. */
export async function respondToDeliveryDesign(
  token: string,
  verb: string,
  note: string,
  seen: unknown,
): Promise<DesignOutcome> {
  if (!PORTAL_ACT_THROTTLE.allow(token)) return THROTTLED;
  if (!isDesignVerb(verb)) return { kind: 'error', error: 'generic' };
  const parsed = parseReviewSeen(seen);
  if (!parsed) return { kind: 'changed' };
  return respondToDesignAndNotify(token, { action: verb, note: clientNote(note), ...(await requestProvenance()) }, parsed);
}

/** Approve the final design and acknowledge the budget range, from one confirmation. */
export async function approveDesignWithBudget(token: string, note: string, seen: unknown): Promise<DesignOutcome> {
  if (!PORTAL_ACT_THROTTLE.allow(token)) return THROTTLED;
  const parsed = parseReviewSeen(seen);
  if (!parsed) return { kind: 'changed' };
  return approveDesignWithBudgetAndNotify(token, { note: clientNote(note), ...(await requestProvenance()) }, parsed);
}

/** Acknowledge the budget band the card showed (the budget card's own button). */
export async function acknowledgeDeliveryBudget(token: string, bandSeen: unknown): Promise<BudgetOutcome> {
  if (!PORTAL_ACT_THROTTLE.allow(token)) return THROTTLED;
  const band = parseBandSeen(bandSeen);
  if (typeof band !== 'string') return { kind: 'changed' };
  return acknowledgeSeenBudgetAndNotify(token, await requestProvenance(), band);
}

/** Confirm receiving the design package. */
export async function acknowledgeDeliveryHandover(token: string, note?: string): Promise<HandoverOutcome> {
  if (!PORTAL_ACT_THROTTLE.allow(token)) return THROTTLED;
  return acknowledgeHandoverAndNotify(token, { note: clientNote(note), ...(await requestProvenance()) });
}
