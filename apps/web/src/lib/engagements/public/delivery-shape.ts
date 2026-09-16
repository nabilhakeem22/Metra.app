// Turning one delivery SNAPSHOT into the client-facing view — pure, and
// deliberately paranoid. Nothing here reads the database or the token.
//
// WHY SO DEFENSIVE: a valid token must never 500, and the snapshot is jsonb from
// a SECURITY DEFINER function — a schema change, an older SDF or a half-populated
// row arrives as a missing key, not as a type error. Every dereference is
// null-safe and every list passes a row guard, so a malformed field costs that
// field and not the page.
import { KIND_CATEGORY } from '../portal-documents';
import { PORTAL_STAGE_LABEL, PORTAL_STAGE_NOTE } from '../portal-labels';
import { parseDocumentAccess } from '../document-access';
import { stateMilestone } from '../journey-map';
import { CLIENT_ACTION_VERBS, deriveHero } from '../portal-hero';
import type { DesignState } from '../states';
import {
  STATE_SET,
  isRenderableClaim,
  isRenderableDocument,
  isRenderableMilestone,
  type DeliverySnapshot,
} from './row-guards';
import type { PublicDelivery, PublicDeliveryMilestone } from './types';

/** The state, only if it is one the portal has labels for. Never a raw key. */
function renderableState(snapshot: DeliverySnapshot): DesignState | null {
  if (!snapshot.state || !STATE_SET.has(snapshot.state)) return null;
  return snapshot.state as DesignState;
}

/**
 * The delivery's identity, or null when the row is junk.
 *
 * A usable delivery needs at least a valid id OR a finite number; if both are
 * unusable there is nothing to render and nothing to act on.
 */
function deliveryIdentity(
  snapshot: DeliverySnapshot,
): { id: string; number: number } | null {
  const hasId = typeof snapshot.id === 'string' && snapshot.id.trim().length > 0;
  const numberIsFinite = Number.isFinite(snapshot.number);
  if (!hasId && !numberIsFinite) return null;
  return {
    id: hasId ? (snapshot.id as string) : '',
    number: numberIsFinite ? (snapshot.number as number) : 0,
  };
}

/** Firm and client names. A missing party degrades to null fields, not a crash. */
function shapeParties(snapshot: DeliverySnapshot): Pick<PublicDelivery, 'firm' | 'client'> {
  const firm = snapshot.firm ?? ({} as NonNullable<DeliverySnapshot['firm']>);
  const client = snapshot.client ?? ({} as NonNullable<DeliverySnapshot['client']>);
  return {
    firm: {
      nameAr: firm.name_ar ?? null,
      nameEn: firm.name_en ?? null,
      logoFileId: firm.logo_file_id ?? null,
    },
    client: { nameAr: client.name_ar ?? null, nameEn: client.name_en ?? null },
  };
}

/** The payment schedule, with every unrenderable milestone dropped. */
function shapeSchedule(snapshot: DeliverySnapshot): PublicDeliveryMilestone[] {
  return Array.isArray(snapshot.payment_schedule)
    ? snapshot.payment_schedule.filter(isRenderableMilestone)
    : [];
}

/**
 * The released files. A missing or non-array `documents` key (an older SDF, a
 * malformed snapshot) degrades to an EMPTY list, so the portal renders its
 * honest "nothing shared yet" state rather than crashing.
 */
function shapeDocuments(snapshot: DeliverySnapshot): PublicDelivery['documents'] {
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
  }));
}

/** The verbs this client may act on now — only ones the portal knows. */
function shapeClientActions(snapshot: DeliverySnapshot): string[] {
  return Array.isArray(snapshot.client_actions)
    ? snapshot.client_actions.filter(
        (verb): verb is string =>
          typeof verb === 'string' && CLIENT_ACTION_VERBS.has(verb),
      )
    : [];
}

/** The milestones the client may claim as paid. A missing or non-array claim
 *  object degrades to null: the portal renders no claim surface at all. */
function shapePaymentClaim(snapshot: DeliverySnapshot): PublicDelivery['paymentClaim'] {
  const rawClaims = snapshot.claim?.claimable_milestones;
  if (!Array.isArray(rawClaims)) return null;
  return {
    claimableMilestones: rawClaims.filter(isRenderableClaim).map((row) => ({
      milestoneKind: row.milestone_kind,
      amountRemaining: row.amount_remaining,
      hasPendingClaim: row.has_pending_claim === true,
    })),
  };
}

/**
 * One snapshot as the portal's view of it, or null when the row cannot be shown.
 *
 * The two nulls are the guards above: an unrecognised state (never render a raw
 * machine key to a client) and an unidentifiable row. Everything after them is
 * mapping, and every piece of it degrades rather than throws.
 */
export function shapeDelivery(snapshot: DeliverySnapshot): PublicDelivery | null {
  const state = renderableState(snapshot);
  if (!state) return null;
  const identity = deliveryIdentity(snapshot);
  if (!identity) return null;

  const clientActions = shapeClientActions(snapshot);
  const rom = snapshot.rom;
  return {
    ...identity,
    stageLabel: PORTAL_STAGE_LABEL[state],
    stageNote: PORTAL_STAGE_NOTE[state],
    milestone: stateMilestone(state),
    hero: deriveHero(clientActions, state),
    offPlan: snapshot.off_plan === true,
    titleAr: snapshot.title_ar ?? null,
    titleEn: snapshot.title_en ?? null,
    createdAt: snapshot.created_at ?? null,
    designFeeTotal: snapshot.design_fee_total ?? null,
    rom: rom ? { low: rom.low ?? null, high: rom.high ?? null } : null,
    shareExpiresAt: snapshot.share_expires_at ?? null,
    ...shapeParties(snapshot),
    paymentSchedule: shapeSchedule(snapshot),
    paymentClaim: shapePaymentClaim(snapshot),
    documents: shapeDocuments(snapshot),
    clientActions,
  };
}
