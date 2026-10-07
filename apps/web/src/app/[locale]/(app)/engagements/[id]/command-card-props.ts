import type { ActionCode } from '@/lib/actions/result';
import type { BoqStepData } from '@/lib/boqs/step';
import type { LetteredConceptOption } from '@/lib/engagements/concept-choice';
import type { FeeSplitPrefill } from '@/lib/engagements/default-fee-split';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { EngagementPaymentClaimRecord } from '@/lib/engagements/queries';
import type { EngagementClientActivityRecord } from '@/lib/engagements/queries/client-activity';
import type { RevisionAllowances } from '@/lib/engagements/revision-allowance';
import type { DesignState } from '@/lib/engagements/states';
import type { Trigger } from '@/lib/engagements/transitions';
import type { RunAction } from './use-engagement-action';

/**
 * Everything the cockpit hands the command card, as ONE named contract.
 *
 * A plain module (NOT 'use client'), types only. Nineteen props is what "the
 * single what's-next surface" costs, and naming the contract is what lets the
 * pieces of the card below take FOUR each instead of nineteen between them.
 */
export interface EngagementCommandCardProps {
  engagementId: string;
  projectId: string;
  /** The project's BOQ, for the `boq` step's lead action. Null when none exists. */
  boqStep: BoqStepData;
  preview: EngagementGatePreview;
  state: DesignState;
  /**
   * BOTH revision counter/allowance pairs — the concept one and the independent
   * 3D one the `designChangeRaised` form prices against. The hero badge picks
   * whichever pair the CURRENT state can spend, so it never contradicts the form.
   */
  allowances: RevisionAllowances;
  /** The delivery's status; decides the card's colour family (stripe + border). */
  status: DeliveryStatus;
  canAdvance: boolean;
  /** May this role record "Client approved offline" (owner, admin, project manager)? */
  canRecordOfflineApproval: boolean;
  /** When the review round under answer began (ISO): the floor of an offline approval's date. */
  reviewRoundStartedAt: string;
  /** The released, lettered concept options an offline choice may name (B12, Q1). */
  conceptOptions: LetteredConceptOption[];
  canRecordPayment: boolean;
  /** May this role confirm or dismiss a client payment claim (`engagements_finance` create)? */
  canResolveClaims: boolean;
  canShare: boolean;
  /** May this role start a quotation (`proposals_build` create)? Linked from the execution ending. */
  canStartQuotation: boolean;
  canUpload: boolean;
  canSetOffPlan: boolean;
  offPlan: boolean;
  /** The fee form's opening split at `created`; null elsewhere. */
  feeSplitPrefill: FeeSplitPrefill | null;
  /** The PENDING client payment claims; while any exists, confirming one is the card's one action. */
  paymentClaims: EngagementPaymentClaimRecord[];
  /** Client Deliverables Step 2 — client questions on documents still awaiting a
   *  studio reply. Rendered as ONE quiet line, never a second CTA: answering is
   *  advisory and must not compete with the card's single next action. */
  awaitingReplyCount: number;
  /** Concept options already recorded — drives the append-only upload cap. */
  conceptOptionCount: number;
  clientActivity: EngagementClientActivityRecord[];
  secondaryTriggers: Trigger[];
  pending: boolean;
  /** Runs one server action with the idempotency key held for that act (0050).
   *  Ignore the argument on an edge that does not need one. */
  runAction: RunAction;
  /** The last card action's refusal, shown inside the card under the action. */
  actionError: ActionCode | null;
  /** Opens the "Send reminder" dialog (the nudge pill, the waiting card). */
  onNudge: () => void;
}
