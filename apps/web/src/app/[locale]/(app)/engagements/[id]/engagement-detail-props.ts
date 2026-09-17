import type { BoqStepSummary } from '@/lib/boqs/step';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import type {
  EngagementArtifactRecord,
  EngagementChangeOrderRecord,
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import type { Trigger } from '@/lib/engagements/transitions';
import type { PanelCapabilities } from './engagement-panels';

/**
 * Everything the server page hands the cockpit, as ONE named contract.
 *
 * A plain module (NOT 'use client'), and types only, so the server page may name
 * what it is assembling without importing a component. Eighteen props assembled
 * across nine reads is a contract worth naming: an unnamed inline type is one
 * nobody can point at when a read is added on one side and forgotten on the other.
 */
export interface EngagementDetailProps {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  clientActivity: EngagementClientActivityRecord[];
  boqSummary: BoqStepSummary | null;
  nextActions: Trigger[];
  capabilities: PanelCapabilities;
  canUpload: boolean;
  canShare: boolean;
  gatePreview: EngagementGatePreview;
  canAdvance: boolean;
  stallDays: number | null;
  pulse: CommercialPulse;
  paymentClaimCount: number;
  /** Client Deliverables Step 2 — client questions still awaiting a studio reply,
   *  across every document on this engagement. Feeds the command card's quiet
   *  one-line prompt and the Files tab badge. */
  awaitingReplyCount: number;
}
