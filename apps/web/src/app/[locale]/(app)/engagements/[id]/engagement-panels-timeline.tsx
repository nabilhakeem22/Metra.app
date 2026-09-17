'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ActionResult } from '@/lib/actions/result';
import type {
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { PanelHeader } from './engagement-panel-header';
import { TimelineFeed } from './timeline-feed';
import {
  OnBehalfActions,
  OnBehalfPanelBox,
  type OnBehalfPanel,
} from './timeline-on-behalf';

/**
 * The Timeline detail tab — transitions, events and the client-activity feed in
 * one record, newest first (the merge itself is timeline-entries.ts, which is
 * pure and tested).
 *
 * It is also the home of the ONE action in this cockpit that asserts somebody
 * else acted: recording a client acknowledgement the studio took offline. It
 * belongs here because this is the record it writes into.
 *
 * The consequence is stated at the point of entry AND on the record afterwards:
 * a staff-recorded acknowledgement carries a permanent marker, so nobody reading
 * this ledger later mistakes it for something the client typed.
 */
export function TimelineTab({
  engagementId,
  transitions,
  events,
  clientActivity,
  canRecordRomAck,
  canRecordHandoffAck,
  canRetract,
  romSet,
  romIssued,
  pending,
  runAction,
}: {
  engagementId: string;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity: EngagementClientActivityRecord[];
  canRecordRomAck: boolean;
  canRecordHandoffAck: boolean;
  /** Owner/admin only — retracting a ledger row is not routine studio work. */
  canRetract: boolean;
  /** A build-cost band exists. Without one there is nothing to acknowledge. */
  romSet: boolean;
  /** The band has been issued to the client. Until then they have seen nothing. */
  romIssued: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  const [panel, setPanel] = useState<OnBehalfPanel | null>(null);

  const availability = {
    canRecordRomAck,
    canRecordHandoffAck,
    romAckBlocked: canRecordRomAck && (!romSet || !romIssued),
  };
  const blockedReason = !romSet ? 'onBehalfBlocked' : 'onBehalfBlockedUnissued';
  const anyOnBehalf = canRecordRomAck || canRecordHandoffAck;

  return (
    <div>
      <PanelHeader
        title={tp('timeline')}
        sub={tpa('timelineSub')}
        reason={availability.romAckBlocked ? tpa(blockedReason) : undefined}
        actions={
          anyOnBehalf && (
            <OnBehalfActions
              availability={availability}
              openPanel={panel}
              pending={pending}
              onToggle={(next) => setPanel((open) => (open === next ? null : next))}
            />
          )
        }
      />
      <div className="p-4">
        {panel !== null && (
          <OnBehalfPanelBox
            panel={panel}
            engagementId={engagementId}
            pending={pending}
            runAction={runAction}
            onDone={() => setPanel(null)}
          />
        )}
        <TimelineFeed
          engagementId={engagementId}
          transitions={transitions}
          events={events}
          clientActivity={clientActivity}
          canRetract={canRetract}
          pending={pending}
          runAction={runAction}
        />
      </div>
    </div>
  );
}
