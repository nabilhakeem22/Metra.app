'use client';

import { useTranslations } from 'next-intl';
import type { ActionResult } from '@/lib/actions/result';
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

// The engagement detail panels — the fuller record below the command card,
// dispatched by the five detail tabs. Files (working-files tray + the full
// artifact list), Timeline (transitions + events + the client-activity feed),
// Payments (the commercial pulse + fee schedule + the payment ledger), Budget
// (the build-cost range and every band recorded before it) and Change orders.
//
// EACH TAB OWNS ITS OWN HEADER, and with it the actions that write into the
// record it displays. That is why the padding moved out of here and into the tab
// bodies: the header band runs edge to edge and carries the rule under it, which
// a shared `p-4` on this wrapper could not do. Visual reskin of the glass system
// as a FLAT (opaque `bg-card`) surface; money is `font-mono tabular-nums`,
// `dir=ltr`. Logical CSS only so it mirrors in ar-EG RTL.

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
}

/** What the signed-in role may write into these records. */
export interface PanelCapabilities {
  recordPayment: boolean;
  recordArtifact: boolean;
  setRom: boolean;
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
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      {tab === 'files' && (
        <FilesTab
          engagementId={engagementId}
          artifacts={data.artifacts}
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
          pending={pending}
          runAction={runAction}
        />
      )}
      {tab === 'payments' && (
        <PaymentsTab
          engagementId={engagementId}
          feeSchedule={data.feeSchedule}
          payments={data.payments}
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
          pending={pending}
          runAction={runAction}
        />
      )}
      {tab === 'changeOrders' && <ChangeOrdersTab changeOrders={data.changeOrders} />}
    </section>
  );
}

/**
 * Change orders — the one tab with no action of its own. A change order is
 * RAISED by a transition (a revision past its allowance, a flagged as-built
 * variance), never typed in here, so a header with no button is the honest one.
 */
function ChangeOrdersTab({
  changeOrders,
}: {
  changeOrders: EngagementChangeOrderRecord[];
}) {
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
