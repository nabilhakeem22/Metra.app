'use server';

import { paymentClaimedAct } from '@/lib/engagements/client-acts/acts';
import { clientNote } from '@/lib/engagements/client-note';
import { withStudioNotified } from '@/lib/engagements/client-acts/notify';
import { claimPaymentByToken, type DeliveryActionResult } from '@/lib/engagements/public';
import {
  addDeliveryCommentByToken,
  getDeliveryDocumentCommentsByToken,
  type DeliveryCommentResult,
} from '@/lib/engagements/public-comments';
import { THREAD_READ_REFUSED, type PortalThreadRead } from '@/lib/engagements/portal-thread-read';
import { portalActAllowed, portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { isUuid } from '@/lib/uuid';
import { requestProvenance } from './request-provenance';

// The client portal's payment claim and document comments. The review acts
// (concept, design, budget, handover) are in ./review-actions.ts.
//
// THE PER-LINK BRAKE (Round D, ../../../../lib/share/portal-rate-limit.ts): the
// claim and a comment share the link's act budget and, past it, write nothing.
// A refused claim answers the generic failure (no error code, so the portal
// shows "something went wrong, try again"); a refused comment answers
// `too_many` ("try again shortly"), and is charged only once it is a valid
// comment. A thread read shares the read budget and, past it, answers the
// REFUSED marker (../../../../lib/engagements/portal-thread-read.ts), never an
// empty thread.

/** A refused claim: the generic failure, nothing written, nobody notified. */
const THROTTLED = { ok: false, studioNotified: false } as const;

/** A portal write's answer, plus whether the studio heard about it: true only
 *  when a notification row was written for THIS act, which is the only time the
 *  portal may say "your designer has been notified". */
export type DeliveryActResult = DeliveryActionResult & { studioNotified?: boolean };
export type DeliveryCommentActResult = DeliveryCommentResult & { studioNotified?: boolean };

/**
 * Public (no-session) client delivery-portal action (Phase 3): the client "mark as
 * paid" on ONE milestone. Captures the client IP + user agent
 * (./request-provenance.ts) for the claim's provenance; the raw token is NEVER
 * logged. The claim is PENDING: no state move, no money ledger (the studio confirms
 * it later), and the amount is locked server-side, so no amount input exists. A
 * first `ok` notifies the finance roles, naming the milestone the SDF accepted.
 */
export async function markDeliveryPaymentPaid(
  token: string,
  milestoneKind: string,
  note?: string,
): Promise<DeliveryActResult> {
  if (!(await portalActAllowed(token))) return THROTTLED;
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
 * the claim above; the raw token is NEVER logged here — it flows straight to
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
  // A malformed id is refused here, as the core would, before it spends the budget.
  if (!isUuid(documentId)) return { ok: false, error: 'token_invalid', studioNotified: false };
  if (!(await portalActAllowed(token))) return { ok: false, error: 'too_many', studioNotified: false };
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
 * array: the caller cannot tell a forged id from an empty thread. The one
 * exception is a link past its read budget, which answers THREAD_READ_REFUSED.
 */
export async function loadDeliveryDocumentComments(
  token: string,
  documentId: string,
): Promise<PortalThreadRead> {
  if (!(await portalReadAllowed(token))) return THREAD_READ_REFUSED;
  return getDeliveryDocumentCommentsByToken(token, documentId);
}
