import type { BoqStepSummary } from '@/lib/boqs/step';
import type { ActionResult } from '@/lib/actions/result';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { EngagementClientActivityRecord } from '@/lib/engagements/queries/client-activity';
import type { RevisionAllowances } from '@/lib/engagements/revision-allowance';
import type { DesignState } from '@/lib/engagements/states';
import type { Trigger } from '@/lib/engagements/transitions';

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
  boqSummary: BoqStepSummary | null;
  preview: EngagementGatePreview;
  state: DesignState;
  /**
   * BOTH revision counter/allowance pairs — the concept one and the independent
   * 3D one the `designChangeRaised` form prices against. The hero badge picks
   * whichever pair the CURRENT state can spend, so it never contradicts the form.
   */
  allowances: RevisionAllowances;
  stallDays: number | null;
  canAdvance: boolean;
  canRecordPayment: boolean;
  canShare: boolean;
  canUpload: boolean;
  canSetOffPlan: boolean;
  offPlan: boolean;
  paymentClaimCount: number;
  /** Client Deliverables Step 2 — client questions on documents still awaiting a
   *  studio reply. Rendered as ONE quiet line, never a second CTA: answering is
   *  advisory and must not compete with the card's single next action. */
  awaitingReplyCount: number;
  /** Concept options already recorded — drives the append-only upload cap. */
  conceptOptionCount: number;
  clientActivity: EngagementClientActivityRecord[];
  secondaryTriggers: Trigger[];
  pending: boolean;
  /** Runs one server action with the page's per-attempt idempotency key
   *  (0050). Ignore the argument on an edge that does not need one. */
  runAction: (
    fn: (idempotencyKey: string) => Promise<ActionResult>,
    trigger?: Trigger,
  ) => void;
  onNudge: () => void;
}
