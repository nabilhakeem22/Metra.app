'use server';

import { clientActOfVerb, paymentClaimedAct } from '@/lib/engagements/client-acts/acts';
import { withStudioNotified } from '@/lib/engagements/client-acts/notify';
import {
  chooseConceptByToken,
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
 * Public (no-session) client delivery-portal action. Captures the client IP +
 * user agent (./request-provenance.ts) for the append-only engagement_events audit
 * trail (mirrors the proposal p/[token] action). The raw token flows straight to
 * recordDeliveryActionByToken, which hashes it — it is NEVER logged here. The
 * signal is advisory: it moves no state and adds no blocking guard. A first `ok`
 * then notifies the studio (client-acts/notify.ts); the act is derived from the
 * verb the SDF just accepted, never from anything else the request carries.
 */
export async function recordDeliveryAction(
  token: string,
  action: string,
  note?: string,
): Promise<DeliveryActResult> {
  // Cap the audit fields before they reach the DB (the SDF also caps note at 2000).
  const result = await recordDeliveryActionByToken(token, {
    action,
    note: note?.trim().slice(0, 2000) || null,
    ...(await requestProvenance()),
  });
  return withStudioNotified(token, result, clientActOfVerb(action));
}

/**
 * Public (no-session) client delivery-portal action (Round B, B12): the client
 * CHOOSES one concept option. `position` is the letter the client saw (1 = A);
 * the SDF accepts it only while that option still has that letter, and saves
 * it, so the studio reads the letter the client tapped. Same provenance capping
 * as recordDeliveryAction; the raw token is NEVER logged here. A first `ok`, or
 * a repeat whose notification was lost, notifies the studio.
 */
export async function chooseDeliveryConcept(
  token: string,
  artifactId: string,
  position: number,
  note?: string,
): Promise<DeliveryActResult> {
  const result = await chooseConceptByToken(token, {
    artifactId,
    position,
    note: note?.trim().slice(0, 2000) || null,
    ...(await requestProvenance()),
  });
  return withStudioNotified(token, result, { kind: 'concept_chosen' });
}

/**
 * Public (no-session) client delivery-portal action (Phase 3): the client "mark as
 * paid" on ONE milestone. Captures the client IP + user agent from the request
 * headers (capped 45/512) for the claim's provenance; the raw token is NEVER logged
 * here — it flows straight to claimPaymentByToken, which hashes it. The claim is a
 * PENDING record: it moves no state and writes no money ledger (the studio confirms
 * it later). The amount is locked server-side to the milestone's remaining due —
 * this action deliberately carries no amount input. A first `ok` notifies the
 * studio's finance roles, naming the milestone the SDF just accepted.
 */
export async function markDeliveryPaymentPaid(
  token: string,
  milestoneKind: string,
  note?: string,
): Promise<DeliveryActResult> {
  const result = await claimPaymentByToken(token, {
    milestoneKind,
    note: note?.trim().slice(0, 2000) || null,
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
