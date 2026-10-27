'use server';

import { hasFieldErrors, type FieldErrors } from '@/lib/actions/field-errors';
import { LINK_BRAKE_REFUSAL, type CodeAnswer } from '@/lib/client-home/code-answers';
import { claimDesignPaymentWithCodeByToken } from '@/lib/client-home/code-acts';
import { paymentClaimedAct } from '@/lib/engagements/client-acts/acts';
import { commentFieldErrors, type CommentField } from '@/lib/engagements/comment-field-rules';
import { withStudioNotified } from '@/lib/engagements/client-acts/notify';
import {
  addDeliveryCommentByToken,
  getDeliveryDocumentCommentsByToken,
  type DeliveryCommentResult,
} from '@/lib/engagements/public-comments';
import { THREAD_READ_REFUSED, type PortalThreadRead } from '@/lib/engagements/portal-thread-read';
import { portalActAllowed, portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { isUuid } from '@/lib/uuid';
import { requestProvenance } from '@/lib/share/request-provenance';

// The client portal's payment claim and document comments. The review acts
// (concept, design, budget, handover) are in ./review-actions.ts.
//
// THE PAYMENT CLAIM NEEDS A ONE-TIME CODE (OD2 strict): the client asks for
// one (./code-actions.ts) and sends it with the claim; there is no claim
// without it.
//
// THE PER-LINK BRAKE (Round D, ../../../../lib/share/portal-rate-limit.ts): the
// claim and a comment share the link's act budget and, past it, write nothing
// and answer `too_many` ("wait a minute"); a comment is charged only once it is
// a valid comment. A thread read shares the read budget and, past it, answers
// the REFUSED marker (../../../../lib/engagements/portal-thread-read.ts), never
// an empty thread.
//
// NOTHING THROWS TO THE CLIENT (Round E R3): the claim and a comment run
// through `answered` (../../../../lib/share/portal-act-failure.ts), so a
// failure underneath answers `uncertain` (a lock wait that gave up with 55P03:
// it may still commit) or `generic` with the reference of its one log line.

/** A write that never reached the database, or failed underneath: nothing
 *  written that anybody can confirm, nobody notified. */
type UnansweredAct = { ok: false; error: 'too_many' } | ({ ok: false } & PortalFailure);

const TOO_MANY = { ok: false, error: 'too_many', studioNotified: false } as const;
const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure, studioNotified: false });

/** A comment refused before anything is sent: blank, or past the thread's cap. */
type CommentRefused = { ok: false; error: 'check_fields'; fields: FieldErrors<CommentField> };
/** A comment's answer, plus whether the studio heard about it: true only when a
 *  notification row was written for THIS comment, which is the only time the
 *  portal may say "your designer has been notified". */
export type DeliveryCommentActResult = (DeliveryCommentResult | UnansweredAct | CommentRefused) & {
  studioNotified?: boolean;
};

/** A design-fee claim's answer, plus whether the studio heard about it (as for a comment). */
export type DesignClaimAnswer = CodeAnswer & { studioNotified: boolean };

/**
 * Public (no-session) client delivery-portal action: the client's "I paid" on
 * ONE design-fee milestone, with the code emailed to them for it. Captures the
 * client IP + user agent (lib/share/request-provenance.ts) for the claim's
 * provenance; the raw token and the code are NEVER logged. The claim is
 * PENDING: no state move, no money ledger (the studio confirms it later), and
 * the amount is locked server-side, so no amount input exists. A first `ok`
 * notifies the finance roles, naming the milestone the database accepted; an
 * `already` (the claim is waiting) notifies only if that was never done.
 */
export async function claimDesignPaymentInHome(
  token: string,
  input: { milestoneKind: string; code: string },
): Promise<DesignClaimAnswer> {
  return answered('claimDesignPaymentInHome', failed, async (): Promise<DesignClaimAnswer> => {
    if (!(await portalActAllowed(token))) return { ...LINK_BRAKE_REFUSAL, studioNotified: false };
    const milestoneKind = input?.milestoneKind;
    const answer = await claimDesignPaymentWithCodeByToken(token, {
      milestoneKind,
      code: input?.code,
      ...(await requestProvenance()),
    });
    if (!answer.ok) return { ...answer, studioNotified: false };
    const act = typeof milestoneKind === 'string' ? paymentClaimedAct(milestoneKind) : null;
    const signal = answer.already ? { ok: true as const, code: 'already' as const } : { ok: true as const };
    const { studioNotified } = await withStudioNotified(token, signal, act);
    return { ...answer, studioNotified };
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
