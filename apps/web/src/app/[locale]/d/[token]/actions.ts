'use server';

import { clientActOfVerb, paymentClaimedAct } from '@/lib/engagements/client-acts/acts';
import { clientNote } from '@/lib/engagements/client-note';
import { chooseConceptAndNotify, respondToConceptAndNotify } from '@/lib/engagements/client-acts/concept-acts';
import { withHandoverClose } from '@/lib/engagements/client-acts/handover-close';
import { withStudioNotified } from '@/lib/engagements/client-acts/notify';
import { isConceptVerb, type ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import {
  claimPaymentByToken,
  recordDeliveryActionByToken,
  type DeliveryActionResult,
} from '@/lib/engagements/public';
import {
  addDeliveryCommentByToken,
  getDeliveryDocumentCommentsByToken,
  type DeliveryCommentResult,
  type PublicDocumentComment,
} from '@/lib/engagements/public-comments';
import { requestProvenance } from './request-provenance';

/** A portal write's answer, plus whether the studio heard about it: true only
 *  when a notification row was written for THIS act, which is the only time the
 *  portal may say "your designer has been notified". */
export type DeliveryActResult = DeliveryActionResult & { studioNotified?: boolean };
export type DeliveryCommentActResult = DeliveryCommentResult & { studioNotified?: boolean };

/**
 * Public (no-session) client delivery-portal action: the capped client IP + user
 * agent (./request-provenance.ts) go to the append-only audit trail; the raw token
 * is hashed downstream and NEVER logged here. A first `ok` notifies the studio
 * (client-acts/notify.ts), the act derived from the verb the SDF accepted. A
 * handover confirmation (`ok`, or `already` to repair a failed close) then closes
 * the design-only delivery in this request (client-acts/handover-close.ts).
 */
export async function recordDeliveryAction(
  token: string,
  action: string,
  note?: string,
): Promise<DeliveryActResult> {
  // Cap the audit fields before they reach the DB; an invisible note is no note.
  const result = await recordDeliveryActionByToken(token, {
    action,
    note: clientNote(note),
    ...(await requestProvenance()),
  });
  return withHandoverClose(token, action, result, () => withStudioNotified(token, result, clientActOfVerb(action)));
}

/**
 * Public (no-session) client delivery-portal action (Round B, B12): the client
 * CHOOSES one concept option. `position` is the letter the client saw (1 = A);
 * the SDF accepts it only while that option still has that letter, and saves
 * it. The answer names only a SAVED decision: on a repeat it is the decision on
 * file, which may differ from this tap (client-acts/concept-acts.ts). Same
 * provenance capping as recordDeliveryAction; the raw token is NEVER logged.
 */
export async function chooseDeliveryConcept(
  token: string,
  artifactId: string,
  position: number,
  note?: string,
): Promise<ConceptChoiceOutcome> {
  return chooseConceptAndNotify(token, {
    artifactId,
    position,
    note: clientNote(note),
    ...(await requestProvenance()),
  });
}

/**
 * Public (no-session) concept-review verbs (B12): approve the concept or ask for
 * changes. Like chooseDeliveryConcept, the answer confirms only a SAVED
 * decision: a repeat reports the decision on file, never the verb just tapped.
 * Any other verb is refused here (a server action is directly invokable).
 */
export async function respondToDeliveryConcept(
  token: string,
  verb: string,
  note?: string,
): Promise<ConceptChoiceOutcome> {
  if (!isConceptVerb(verb)) return { kind: 'error', error: 'generic' };
  return respondToConceptAndNotify(token, {
    action: verb,
    note: clientNote(note),
    ...(await requestProvenance()),
  });
}

/**
 * Public (no-session) client delivery-portal action (Phase 3): the client "mark as
 * paid" on ONE milestone, with the same provenance capping; the raw token is NEVER
 * logged. The claim is PENDING: no state move, no money ledger (the studio confirms
 * it later), and the amount is locked server-side, so no amount input exists. A
 * first `ok` notifies the finance roles, naming the milestone the SDF accepted.
 */
export async function markDeliveryPaymentPaid(
  token: string,
  milestoneKind: string,
  note?: string,
): Promise<DeliveryActResult> {
  const result = await claimPaymentByToken(token, {
    milestoneKind,
    note: clientNote(note),
    ...(await requestProvenance()),
  });
  return withStudioNotified(token, result, paymentClaimedAct(milestoneKind));
}

/**
 * Public (no-session) client delivery-portal action (Client Deliverables Step 2):
 * APPEND one client message to ONE released document's thread. Captures the client
 * IP + user agent (capped 45/512) for the append-only row's provenance, exactly like
 * the two actions above; the raw token is NEVER logged here — it flows straight to
 * addDeliveryCommentByToken, which hashes it.
 *
 * The message is ADVISORY: it moves no state and opens no change order. The client
 * still approves or requests changes with the stage buttons — this only lets them
 * say WHICH drawing and WHAT about it. Every sent message notifies the studio;
 * a burst collapses into one unread notification with a count.
 */
export async function addDeliveryComment(
  token: string,
  documentId: string,
  body: string,
): Promise<DeliveryCommentActResult> {
  // Cap before the DB (the SDF also trims + caps at 2000 and CHECKs the length).
  const trimmed = body?.trim().slice(0, 2000) ?? '';
  if (!trimmed) return { ok: false, error: 'empty', studioNotified: false };
  const result = await addDeliveryCommentByToken(token, {
    documentId,
    body: trimmed,
    ...(await requestProvenance()),
  });
  return withStudioNotified(token, result, { kind: 'commented' });
}

/**
 * Public (no-session) read of ONE released document's thread, called when the client
 * OPENS that document's comments (never on the portal's first paint), so an unopened
 * portal carries no message bodies at all. Every failure returns the same empty
 * array — the caller cannot tell a forged id from an empty thread.
 */
export async function loadDeliveryDocumentComments(
  token: string,
  documentId: string,
): Promise<PublicDocumentComment[]> {
  return getDeliveryDocumentCommentsByToken(token, documentId);
}
