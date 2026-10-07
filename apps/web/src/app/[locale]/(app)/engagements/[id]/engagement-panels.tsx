'use client';

import { useTranslations } from 'next-intl';
import type { MilestoneKind } from '@metra/db';
import { chosenConceptOf } from '@/lib/engagements/concept-choice';
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
import { PanelHeader } from './engagement-panel-header';
import { BudgetTab } from './engagement-panels-budget';
import { ChangeOrdersPanel } from './engagement-panels-change-orders';
import { FilesTab } from './engagement-panels-files';
import { PaymentsTab } from './engagement-panels-payments-tab';
import { TimelineTab } from './engagement-panels-timeline';
import type { EngagementTab } from './tabs';
import type { RunAction } from './use-engagement-action';

// The engagement detail panels: the fuller record below the command card,
// dispatched by the five detail tabs (Files, Timeline, Payments, Budget, Change
// orders). EACH TAB OWNS ITS OWN HEADER, and with it the actions that write into
// the record it displays, so the padding lives in the tab bodies (the header
// band runs edge to edge). A flat `bg-card` surface; logical CSS only.

export interface PanelData {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  clientActivity: EngagementClientActivityRecord[];
  pulse: CommercialPulse;
  /** Milestones with a client payment claim still pending (the manual log waits on it). */
  claimedMilestones: readonly MilestoneKind[];
}

/** What the signed-in role may write into these records. */
export interface PanelCapabilities {
  recordPayment: boolean;
  recordArtifact: boolean;
  setRom: boolean;
  /** Issuing the band to the client — owner/admin only. */
  issueRom: boolean;
  recordRomAck: boolean;
  /** Offered only while the engagement sits at design_only_handoff. */
  recordHandoffAck: boolean;
  /** Retracting a ledger row — owner/admin only. */
  retract: boolean;
}

export function EngagementPanels({
  tab,
  data,
  engagementId,
  canUpload,
  capabilities,
  pending,
  runAction,
}: {
  tab: EngagementTab;
  data: PanelData;
  engagementId: string;
  canUpload: boolean;
  capabilities: PanelCapabilities;
  pending: boolean;
  runAction: RunAction;
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      {tab === 'files' && (
        <FilesTab
          engagementId={engagementId}
          artifacts={data.artifacts}
          chosenConcept={chosenConceptOf(data.events)}
          canUpload={canUpload}
          canRecordArtifact={capabilities.recordArtifact}
          pending={pending}
          runAction={runAction}
        />
      )}
      {tab === 'timeline' && (
        <TimelineTab
          engagementId={engagementId}
          transitions={data.transitions}
          events={data.events}
          clientActivity={data.clientActivity}
          canRecordRomAck={capabilities.recordRomAck}
          canRecordHandoffAck={capabilities.recordHandoffAck}
          canRetract={capabilities.retract}
          romSet={data.header.romLow !== null && data.header.romHigh !== null}
          romIssued={data.header.romIssuedAt !== null}
          pending={pending}
          runAction={runAction}
        />
      )}
      {tab === 'payments' && (
        <PaymentsTab
          engagementId={engagementId}
          feeSchedule={data.feeSchedule}
          payments={data.payments}
          claimedMilestones={data.claimedMilestones}
          pulse={data.pulse}
          canRecordPayment={capabilities.recordPayment}
          pending={pending}
          runAction={runAction}
        />
      )}
      {tab === 'budget' && (
        <BudgetTab
          engagementId={engagementId}
          header={data.header}
          events={data.events}
          canSetRom={capabilities.setRom}
          canIssueRom={capabilities.issueRom}
          pending={pending}
          runAction={runAction}
        />
      )}
      {tab === 'changeOrders' && <ChangeOrdersTab changeOrders={data.changeOrders} />}
    </section>
  );
}

/**
 * Change orders: the one tab with no action of its own. A change order is RAISED
 * by a transition, never typed in here, so a header with no button is honest.
 */
function ChangeOrdersTab({ changeOrders }: { changeOrders: EngagementChangeOrderRecord[] }) {
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  return (
    <div>
      <PanelHeader title={tp('changeOrders')} sub={tpa('changeOrdersSub')} />
      <div className="p-4">
        <ChangeOrdersPanel changeOrders={changeOrders} />
      </div>
    </div>
  );
}
