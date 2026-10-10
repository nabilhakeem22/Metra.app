// The LISTS of one delivery snapshot as the portal shows them: the payment
// schedule, the released documents, the verbs on offer, the claimable
// milestones. PURE. Every list passes a row guard (./row-guards.ts), so a
// malformed row costs that row, never the page; a missing or non-array key is
// an empty list (or a null claim object), never a throw.
import { parseDocumentAccess } from '../document-access';
import { KIND_CATEGORY } from '../portal-documents';
import { CLIENT_ACTION_VERBS } from '../portal-hero';
import {
  isRenderableClaim,
  isRenderableDocument,
  isRenderableMilestone,
  type DeliverySnapshot,
} from './row-guards';
import { documentMedia, isoInstant } from './snapshot-values';
import type { PublicDelivery, PublicDeliveryMilestone } from './types';

/** The payment schedule, with every unrenderable milestone dropped. */
export function shapeSchedule(snapshot: DeliverySnapshot): PublicDeliveryMilestone[] {
  return Array.isArray(snapshot.payment_schedule)
    ? snapshot.payment_schedule.filter(isRenderableMilestone)
    : [];
}

/**
 * The released files. A missing or non-array `documents` key (an older SDF, a
 * malformed snapshot) degrades to an EMPTY list, so the portal renders its
 * honest "nothing shared yet" state rather than crashing.
 */
export function shapeDocuments(snapshot: DeliverySnapshot): PublicDelivery['documents'] {
  if (!Array.isArray(snapshot.documents)) return [];
  return snapshot.documents.filter(isRenderableDocument).map((row) => ({
    id: row.id,
    category: KIND_CATEGORY[row.kind],
    sharedAt: row.shared_at ?? null,
    // A count, never a body — the thread itself is a separate, lazy fetch.
    // Non-numeric / negative jsonb degrades to 0 rather than rendering junk.
    commentCount:
      typeof row.comment_count === 'number' && row.comment_count > 0
        ? Math.floor(row.comment_count)
        : 0,
    // Junk parses to `withheld`, never to `download`.
    access: parseDocumentAccess(row.access),
    media: documentMedia(row.media),
  }));
}

/** The verbs this client may act on now — only ones the portal knows. */
export function shapeClientActions(snapshot: DeliverySnapshot): string[] {
  return Array.isArray(snapshot.client_actions)
    ? snapshot.client_actions.filter(
        (verb): verb is string =>
          typeof verb === 'string' && CLIENT_ACTION_VERBS.has(verb),
      )
    : [];
}

/** The milestones the client may claim as paid. A missing or non-array claim
 *  object degrades to null: the portal renders no claim surface at all. */
export function shapePaymentClaim(snapshot: DeliverySnapshot): PublicDelivery['paymentClaim'] {
  const rawClaims = snapshot.claim?.claimable_milestones;
  if (!Array.isArray(rawClaims)) return null;
  return {
    claimableMilestones: rawClaims.filter(isRenderableClaim).map((row) => {
      const hasPendingClaim = row.has_pending_claim === true;
      return {
        milestoneKind: row.milestone_kind,
        amountRemaining: row.amount_remaining,
        hasPendingClaim,
        // Only an OPEN claim has a "sent on" date.
        claimedAt: hasPendingClaim ? isoInstant(row.claimed_at) : null,
      };
    }),
  };
}
