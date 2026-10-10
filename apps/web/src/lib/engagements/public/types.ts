// The client-facing delivery shapes — PURE TYPES, no runtime value, no
// `server-only`. The portal's client components import `PublicDelivery`, so this
// file must stay free of anything a browser bundle cannot hold.
//
// COST-BLIND BY CONSTRUCTION: there is no cost, margin, build-cost, internal note
// or raw machine-state field anywhere below. The SDF omits them; this type is the
// second wall, because a field that does not exist here cannot be rendered.
import type { ConceptLetter } from '../concept-letter';
import type { DocumentAccess } from '../document-access';
import type { MilestoneProgress } from '../journey-map';
import type { ClientDocumentCategory } from '../portal-documents';
import type { HeroView } from '../portal-hero';
import type { PortalStageKey } from '../portal-stage';
import type { PortalDocumentMedia, PortalPaymentDetails, PortalTimelineEntry } from './timeline-types';

export type { PortalDocumentMedia, PortalPaymentDetails, PortalTimelineEntry } from './timeline-types';

/** One milestone in the client's payment schedule — DUE amounts only, no cost. */
export interface PublicDeliveryMilestone {
  milestone_kind: string;
  basis: string;
  amount_due: string;
  amount_cleared: string;
  status: 'paid' | 'partial' | 'due';
}

/** The firm-branded, cost-stripped snapshot the portal renders. */
export interface PublicDelivery {
  id: string;
  number: number;
  /** The client word for the current stage (mapped from `state` server-side);
   *  its label and note are `delivery.stage.<key>` in the catalogs. The raw
   *  machine state is deliberately NOT part of this client-facing shape, so it
   *  never reaches the browser payload, and no stage key equals a state name. */
  stageKey: PortalStageKey;
  /** The client's position on the 6-milestone journey. Derived server-side from
   *  the raw state so the machine state name never reaches the browser payload. */
  milestone: MilestoneProgress;
  /** The single "what needs you now" hero. Derived server-side (no raw state). */
  hero: HeroView;
  offPlan: boolean;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: string | null;
  /** The design fee the CLIENT pays (scale-4 string), or null before it is set. */
  designFeeTotal: string | null;
  /** The budget band (scale-4 strings), or null when unset OR not yet ISSUED —
   *  an unissued band is the studio's private working state. */
  rom: { low: string | null; high: string | null } | null;
  shareExpiresAt: string | null;
  /** The studio. `hasLogo` only says the logo route may answer (the file id
   *  never reaches the browser). `phone` is the studio's number as stored
   *  (digits, one leading +); `whatsappDigits` the international digits wa.me
   *  takes, from the WhatsApp number or else the phone. Null when unusable. */
  firm: {
    nameAr: string | null;
    nameEn: string | null;
    hasLogo: boolean;
    phone: string | null;
    whatsappDigits: string | null;
  };
  client: { nameAr: string | null; nameEn: string | null };
  paymentSchedule: PublicDeliveryMilestone[];
  /** Client Delivery Portal Phase 3 — the milestones the client MAY "mark as paid"
   *  right now (ANY unsettled milestone, remaining due > 0). `amountRemaining` is a
   *  server-locked scale-4 string (the client never sends an amount);
   *  `hasPendingClaim` is true when an OPEN claim already awaits studio confirmation.
   *  Null when the snapshot carried no claim object. */
  paymentClaim: {
    claimableMilestones: Array<{
      milestoneKind: string;
      amountRemaining: string;
      hasPendingClaim: boolean;
      /** When the client marked it as paid (the pending claim), or null. */
      claimedAt: string | null;
    }>;
  } | null;
  /** Round C: the studio's payment instructions, ONLY while a milestone is
   *  claimable and a usable method (InstaPay, an account number or an IBAN) is
   *  set; null otherwise. Values the studio typed: rendered as text, never links. */
  paymentDetails: PortalPaymentDetails | null;
  /** Round C: what happened, dated, newest first (at most 60). Client words
   *  only (a stage key, a decision word, a payment kind), never a machine state. */
  timeline: PortalTimelineEntry[];
  /** Round C: the date (YYYY-MM-DD) the studio expects the next step, or null. */
  expectedOn: string | null;
  /** Round C: the client's design decision on file for the CURRENT render round. */
  designDecision: { kind: 'approved' | 'changes_requested'; at: string } | null;
  /** Round C: when the handover was confirmed (by the client, or recorded by the studio). */
  handoverAcknowledgedAt: string | null;
  /** Round C: when the client acknowledged the budget range issued NOW. */
  romAcknowledgedAt: string | null;
  /** Round C: the newest dated thing on the page (a timeline entry or a shared file). */
  lastUpdateAt: string | null;
  /** Client Deliverables Step 1 — the files the studio has released to this client,
   *  newest share first. Only the id (the download route's filter), a friendly
   *  category, and the share date cross the wire — never a label, filename or size. */
  documents: Array<{
    id: string;
    category: ClientDocumentCategory;
    sharedAt: string | null;
    /** Client Deliverables Step 2 — how many messages this document's thread holds.
     *  A count only; the messages are fetched per-document when the client opens
     *  the thread, so an unopened portal never carries any comment bodies. */
    commentCount: number;
    /** Client Deliverables Step 3 — what this client may do with the file right
     *  now, as the DATABASE decided. The card renders from it; the download route
     *  independently re-reads and enforces it, so hiding a button is never the
     *  only thing standing between an unpaid client and the file. */
    access: DocumentAccess;
    /** Round C: image, pdf or other, by the database's one media rule. */
    media: PortalDocumentMedia;
  }>;
  /** Client-facing verb tokens the client MAY act on right now (approve_concept,
   *  request_concept_changes, approve_design, request_design_changes,
   *  acknowledge_rom, acknowledge_handoff). Server-computed by the SDF; NEVER a raw
   *  machine state name. Empty when nothing is actionable / already confirmed. */
  clientActions: string[];
  /** Round B (B12): the concept options the client may choose between, in the
   *  order the client sees them, lettered by the DATABASE (A to D). Only the id
   *  and the letter cross the wire, never a label or a file name. */
  conceptOptions: Array<{ id: string; position: 1 | 2 | 3 | 4; letter: ConceptLetter }>;
  /** The option the client chose and the letter SAVED with that choice (the one
   *  they saw), or null. Survives the studio hiding or releasing options. */
  conceptChoice: { id: string; letter: ConceptLetter } | null;
  /** The client's concept decision on file (an option chosen, a plain approval,
   *  or changes requested), or null: what a repeat tap is told was SAVED. */
  conceptDecision: 'chosen' | 'approved' | 'changes_requested' | null;
}
