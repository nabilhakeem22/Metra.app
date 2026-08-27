'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type {
  EngagementArtifactRecord,
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { ClientActivityPanel } from './engagement-client-activity-panel';
import { EngagementFilesTray } from './engagement-files-tray';
import { FeePanel, TimelinePanel } from './engagement-panels';

// Epic D, Slice 5 — the cockpit's right rail, in the mock order: the pinned
// "Working files" tray (top) → the always-visible "Client activity" feed → the
// collapsible fee-schedule / audit ledger → recent activity. Pure composition over
// data the page already loaded; every card is a FLAT glass panel (opaque `bg-card`,
// no backdrop-filter) so the rail never adds to the cockpit blur budget. Logical
// CSS only (RTL mirrors).

export function EngagementRightRail({
  engagementId,
  artifacts,
  canUpload,
  clientActivity,
  feeSchedule,
  transitions,
  events,
}: {
  engagementId: string;
  artifacts: EngagementArtifactRecord[];
  canUpload: boolean;
  clientActivity: EngagementClientActivityRecord[];
  feeSchedule: EngagementFeeSchedule;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
}) {
  const t = useTranslations('engagements');
  const tr = useTranslations('engagements.rail');

  return (
    <div className="space-y-4">
      <EngagementFilesTray
        artifacts={artifacts}
        engagementId={engagementId}
        canUpload={canUpload}
      />

      <CockpitDrawerCard title={t('panels.clientActivity')}>
        <ClientActivityPanel activity={clientActivity} />
      </CockpitDrawerCard>

      <CockpitDrawerCard
        title={t('panels.fee')}
        drawerLabel={tr('auditLedger')}
        collapsible
        defaultOpen
      >
        <FeePanel feeSchedule={feeSchedule} />
      </CockpitDrawerCard>

      <CockpitDrawerCard title={tr('recentActivity')}>
        <TimelinePanel transitions={transitions} events={events} />
      </CockpitDrawerCard>
    </div>
  );
}

function CockpitDrawerCard({
  title,
  drawerLabel,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  drawerLabel?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const titleText = (
    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
      {title}
    </span>
  );
  const drawerText = drawerLabel && (
    <span className="text-[11px] text-[color:var(--text-muted)]">
      {collapsible ? (open ? '▾ ' : '▸ ') : ''}
      {drawerLabel}
    </span>
  );
  const rowClass =
    'flex w-full items-center justify-between border-b border-[color:var(--rule)] px-4 py-3 text-start';

  return (
    <section className="overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      {/* Accessible accordion markup: the heading wraps the toggle button. */}
      <h3 className="m-0">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className={rowClass}
          >
            {titleText}
            {drawerText}
          </button>
        ) : (
          <span className={rowClass}>
            {titleText}
            {drawerText}
          </span>
        )}
      </h3>
      {(!collapsible || open) && <div className="px-4 py-2">{children}</div>}
    </section>
  );
}
