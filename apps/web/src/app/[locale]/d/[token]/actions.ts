'use server';

import { hasFieldErrors, type FieldErrors } from '@/lib/actions/field-errors';
import { paymentClaimedAct } from '@/lib/engagements/client-acts/acts';
import { commentFieldErrors, type CommentField } from '@/lib/engagements/comment-field-rules';
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
import type { PortalFailure } from '@/lib/share/portal-act-failure';
import { isUuid } from '@/lib/uuid';
import { answered } from './answered';
import { requestProvenance } from './request-provenance';

// The client portal's payment claim and document comments. The review acts
// (concept, design, budget, handover) are in ./review-actions.ts.
//
// THE PER-LINK BRAKE (Round D, ../../../../lib/share/portal-rate-limit.ts): the
// claim and a comment share the link's act budget and, past it, write nothing
// and answer `too_many` ("wait a minute"); a comment is charged only once it is
// a valid comment. A thread read shares the read budget and, past it, answers
// the REFUSED marker (../../../../lib/engagements/portal-thread-read.ts), never
// an empty thread.
//
// NOTHING THROWS TO THE CLIENT (Round E R3): the claim and a comment run
// through ./answered.ts, so a failure underneath answers `uncertain` (a lock
// wait that gave up with 55P03: it may still commit) or `generic` with the
// reference of its one redacted log line.

/** A write that never reached the database, or failed underneath: nothing
 *  written that anybody can confirm, nobody notified. */
type UnansweredAct = { ok: false; error: 'too_many' } | ({ ok: false } & PortalFailure);

const TOO_MANY = { ok: false, error: 'too_many', studioNotified: false } as const;
const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure, studioNotified: false });

/** A portal write's answer, plus whether the studio heard about it: true only
 *  when a notification row was written for THIS act, which is the only time the
 *  portal may say "your designer has been notified". */
export type DeliveryActResult = (DeliveryActionResult | UnansweredAct) & { studioNotified?: boolean };
/** A comment refused before anything is sent: blank, or past the thread's cap. */
type CommentRefused = { ok: false; error: 'check_fields'; fields: FieldErrors<CommentField> };
export type DeliveryCommentActResult = (DeliveryCommentResult | UnansweredAct | CommentRefused) & {
  studioNotified?: boolean;
};

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
  return answered('markDeliveryPaymentPaid', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    const result = await claimPaymentByToken(token, {
      milestoneKind,
      note: clientNote(note),
      ...(await requestProvenance()),
    });
    return withStudioNotified(token, result, paymentClaimedAct(milestoneKind));
  });
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
  // Refused before the DB, under the box: blank, or past the cap the table's
  // CHECK holds (never silently cut). Directly invokable: a body that is not a
  // string is an empty one, never a throw.
  const bodyErrors = commentFieldErrors(body);
  if (hasFieldErrors(bodyErrors)) return { ok: false, error: 'check_fields', fields: bodyErrors, studioNotified: false };
  const trimmed = body.trim();
  // A malformed id is refused here, as the core would, before it spends the budget.
  if (!isUuid(documentId)) return { ok: false, error: 'token_invalid', studioNotified: false };
  return answered('addDeliveryComment', failed, async () => {
    if (!(await portalActAllowed(token))) return TOO_MANY;
    const result = await addDeliveryCommentByToken(token, {
      documentId,
      body: trimmed,
      ...(await requestProvenance()),
    });
    return withStudioNotified(token, result, { kind: 'commented' });
  });
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
  return answered('loadDeliveryDocumentComments', () => [], async () => {
    if (!(await portalReadAllowed(token))) return THREAD_READ_REFUSED;
    return getDeliveryDocumentCommentsByToken(token, documentId);
  });
}
