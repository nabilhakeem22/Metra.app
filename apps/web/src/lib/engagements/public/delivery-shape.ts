// Turning one delivery SNAPSHOT into the client-facing view: pure, and
// deliberately paranoid, because a valid token must never 500. The snapshot is
// jsonb from a SECURITY DEFINER function, so a schema change or an older SDF
// arrives as a missing key, not a type error. Every dereference is null-safe and
// every list passes a row guard: a malformed field costs that field, not the page.
//
// RAW KEYS STOP HERE. The snapshot carries machine words (a state, an event
// kind on the timeline, the logo's file id); each is translated into a client
// word or a boolean below, so none of them reaches the browser payload.
import { stateMilestone } from '../journey-map';
import { deriveHero } from '../portal-hero';
import { PORTAL_STAGE_KEY } from '../portal-stage';
import type { DesignState } from '../states';
import { parseConceptChoice, parseConceptDecision, parseConceptOptions } from './concept-rows';
import { parseDesignDecision } from './review-rows';
import { STATE_SET, type DeliverySnapshot } from './row-guards';
import { shapeClientActions, shapeDocuments, shapePaymentClaim, shapeSchedule } from './shape-lists';
import { calendarDay, isoInstant, newestInstant } from './snapshot-values';
import { parseFirm, parsePaymentDetails } from './studio-rows';
import { parseTimeline } from './timeline-rows';
import type { PublicDelivery } from './types';

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

/** The end client's names. A missing party degrades to null fields, not a crash. */
function shapeClient(snapshot: DeliverySnapshot): PublicDelivery['client'] {
  const client = snapshot.client ?? ({} as NonNullable<DeliverySnapshot['client']>);
  return { nameAr: client.name_ar ?? null, nameEn: client.name_en ?? null };
}

/** The money side: the schedule, what may be claimed, and where to pay while something may. */
function shapePayments(
  snapshot: DeliverySnapshot,
): Pick<PublicDelivery, 'paymentSchedule' | 'paymentClaim' | 'paymentDetails'> {
  const paymentClaim = shapePaymentClaim(snapshot);
  return {
    paymentSchedule: shapeSchedule(snapshot),
    paymentClaim,
    paymentDetails: parsePaymentDetails(snapshot.payment_details, paymentClaim?.claimableMilestones.length ?? 0),
  };
}

/** What happened and what is on file (Round C): every instant parsed, every key translated. */
function shapeRecord(
  snapshot: DeliverySnapshot,
  documents: PublicDelivery['documents'],
): Pick<PublicDelivery, 'timeline' | 'expectedOn' | 'designDecision' | 'handoverAcknowledgedAt' | 'romAcknowledgedAt' | 'lastUpdateAt'> {
  const timeline = parseTimeline(snapshot.timeline);
  return {
    timeline,
    expectedOn: calendarDay(snapshot.expected_on),
    designDecision: parseDesignDecision(snapshot.design_decision),
    handoverAcknowledgedAt: isoInstant(snapshot.handover_acknowledged_at),
    romAcknowledgedAt: isoInstant(snapshot.rom_acknowledged_at),
    lastUpdateAt: newestInstant([timeline[0]?.at ?? null, ...documents.map((document) => document.sharedAt)]),
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
  const documents = shapeDocuments(snapshot);
  const rom = snapshot.rom;
  return {
    ...identity,
    stageKey: PORTAL_STAGE_KEY[state],
    milestone: stateMilestone(state),
    hero: deriveHero(clientActions, state),
    offPlan: snapshot.off_plan === true,
    titleAr: snapshot.title_ar ?? null,
    titleEn: snapshot.title_en ?? null,
    createdAt: snapshot.created_at ?? null,
    designFeeTotal: snapshot.design_fee_total ?? null,
    rom: rom ? { low: rom.low ?? null, high: rom.high ?? null } : null,
    shareExpiresAt: snapshot.share_expires_at ?? null,
    firm: parseFirm(snapshot.firm),
    client: shapeClient(snapshot),
    ...shapePayments(snapshot),
    documents,
    clientActions,
    conceptOptions: parseConceptOptions(snapshot.concept_options),
    conceptChoice: parseConceptChoice(snapshot.concept_choice_id, snapshot.concept_choice_position),
    conceptDecision: parseConceptDecision(snapshot.concept_decision),
    ...shapeRecord(snapshot, documents),
  };
}
