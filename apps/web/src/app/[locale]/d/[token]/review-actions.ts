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
  type DesignWithBudgetOutcome,
  type HandoverOutcome,
} from '@/lib/engagements/review-outcome';
import { parseBandSeen, parseReviewSeen } from '@/lib/engagements/review-seen';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalActAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';

// The client's REVIEW acts on the portal: the concept, the final design, the
// budget range and the handover. Public (no session): the share token IS the
// authorization, flows straight to the act modules, which hash it, and is
// NEVER logged here. Each act captures the client's IP and user agent
// (lib/share/request-provenance.ts) for the append-only engagement_events trail, and an
// invisible note is no note (clientNote). Every answer names only a decision
// that is SAVED (../../../../lib/engagements/review-outcome.ts): a repeat reports
// the decision on file, never the verb just tapped. A verb outside an act's
// own pair is refused here as `wrong_state` (nothing written): a server action
// is directly invokable.
//
// WHAT WAS SEEN (Round D): the design and budget acts carry the issuance
// instants the client's page showed (the render round, the band;
// ../../../../lib/engagements/review-seen.ts), and the database refuses an act
// whose issuance is no longer the one on file. A missing or malformed one (a
// page from before Round D during a deploy, a forged call) reads "changed":
// nothing is written and the page re-reads.
//
// A PER-LINK BRAKE (Round D): 30 acts a minute per link, per Cloudflare data
// centre (../../../../lib/share/portal-rate-limit.ts); past it an act answers
// `too_many` ("wait a minute") and writes nothing.
//
// NOTHING THROWS TO THE CLIENT (D3 L1): every act runs through `answered`,
// which answers `uncertain` or `generic` with a reference.

const TOO_MANY = { kind: 'error', error: 'too_many' } as const;
const NOT_THIS_ACT = { kind: 'error', error: 'wrong_state' } as const;
const failed = (failure: PortalFailure) => ({ kind: 'error' as const, ...failure });

/** Choose one concept option, by the letter the client saw (1 = A). */
export async function chooseDeliveryConcept(
  token: string,
  artifactId: string,
  position: number,
  note?: string,
): Promise<ConceptChoiceOutcome> {
  return answered('chooseDeliveryConcept', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    return chooseConceptAndNotify(token, { artifactId, position, note: clientNote(note), ...(await requestProvenance()) });
  });
}

/** Approve the concept or ask for changes to it. */
export async function respondToDeliveryConcept(token: string, verb: string, note?: string): Promise<ConceptChoiceOutcome> {
  return answered('respondToDeliveryConcept', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    if (!isConceptVerb(verb)) return NOT_THIS_ACT;
    return respondToConceptAndNotify(token, { action: verb, note: clientNote(note), ...(await requestProvenance()) });
  });
}

/** Approve the final design or ask for changes to it, about the round the client saw. */
export async function respondToDeliveryDesign(
  token: string,
  verb: string,
  note: string,
  seen: unknown,
): Promise<DesignOutcome> {
  return answered('respondToDeliveryDesign', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    if (!isDesignVerb(verb)) return NOT_THIS_ACT;
    const parsed = parseReviewSeen(seen);
    if (!parsed) return { kind: 'changed' };
    return respondToDesignAndNotify(token, { action: verb, note: clientNote(note), ...(await requestProvenance()) }, parsed);
  });
}

/**
 * Approve the final design and acknowledge the budget range, from one
 * confirmation: two consents, each saved or refused on its own issuance. With
 * no band on the page there is no budget to confirm: nothing is written.
 */
export async function approveDesignWithBudget(token: string, note: string, seen: unknown): Promise<DesignWithBudgetOutcome> {
  return answered('approveDesignWithBudget', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    const parsed = parseReviewSeen(seen);
    if (!parsed || parsed.romIssuedAt === null) return { kind: 'changed', budget: 'changed' };
    return approveDesignWithBudgetAndNotify(
      token,
      { note: clientNote(note), ...(await requestProvenance()) },
      { romIssuedAt: parsed.romIssuedAt, rendersIssuedAt: parsed.rendersIssuedAt },
    );
  });
}

/** Acknowledge the band issuance the card showed (the budget card's own button). */
export async function acknowledgeDeliveryBudget(token: string, bandSeen: unknown): Promise<BudgetOutcome> {
  return answered('acknowledgeDeliveryBudget', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    const band = parseBandSeen(bandSeen);
    if (typeof band !== 'string') return { kind: 'changed' };
    return acknowledgeSeenBudgetAndNotify(token, await requestProvenance(), band);
  });
}

/** Confirm receiving the design package. */
export async function acknowledgeDeliveryHandover(token: string, note?: string): Promise<HandoverOutcome> {
  return answered('acknowledgeDeliveryHandover', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    return acknowledgeHandoverAndNotify(token, { note: clientNote(note), ...(await requestProvenance()) });
  });
}
