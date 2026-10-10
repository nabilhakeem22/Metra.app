// The Round C client-page shapes (0058): the dated timeline, the studio's
// payment instructions, a document's media class. PURE TYPES, client-safe.
//
// CLIENT WORDS ONLY. The snapshot carries raw machine keys (a state name, an
// engagement_events kind); the mapper translates every one of them into the
// words below before anything reaches the browser, and drops what it cannot.
import type { ConceptLetter } from '../concept-letter';
import type { PortalStageKey } from '../portal-stage';

/** What a released file is, by the database's one media rule. */
export type PortalDocumentMedia = 'image' | 'pdf' | 'other';

/** A client decision on the timeline, in the client's words. */
export type PortalTimelineDecision =
  | 'concept_approved'
  | 'concept_chosen'
  | 'concept_changes'
  | 'design_approved'
  | 'design_changes'
  | 'budget_acknowledged'
  | 'handover_acknowledged';

/** The money the client paid, by the payment's kind. */
export type PortalPaymentKind = 'deposit' | 'gate_a' | 'gate_b' | 'balance' | 'revision_co';

/** One dated line of "what happened". `at` is an ISO instant. */
export type PortalTimelineEntry =
  | { type: 'stage'; stageKey: PortalStageKey; at: string }
  | {
      type: 'decision';
      decision: PortalTimelineDecision;
      /** The studio recorded it for the client (a call, a meeting, a signed paper). */
      byStudio: boolean;
      /** The option letter of a concept choice, else null. */
      letter: ConceptLetter | null;
      at: string;
    }
  | { type: 'payment'; kind: PortalPaymentKind; amount: string; at: string };

/** The studio's own payment instructions, as text. */
export interface PortalPaymentDetails {
  instapay: string | null;
  bankName: string | null;
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankIban: string | null;
}
