'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type {
  EngagementArtifactRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { EngagementFilesTray } from './engagement-files-tray';
import { FeePanel, TimelinePanel } from './engagement-panels';

// Epic D, Slice 5 — the cockpit's right rail, in the mock order: the pinned
// "Working files" tray (top) → the collapsible fee-schedule / audit ledger →
// recent activity. Pure composition over data the page already loaded; every card
// wears the scoped `.engagement-cockpit` palette. Logical CSS only (RTL mirrors).

export function EngagementRightRail({
  artifacts,
  feeSchedule,
  transitions,
  events,
}: {
  artifacts: EngagementArtifactRecord[];
  feeSchedule: EngagementFeeSchedule;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
}) {
  const t = useTranslations('engagements');
  const tr = useTranslations('engagements.rail');

  return (
    <div className="space-y-4">
      <EngagementFilesTray artifacts={artifacts} />

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
    <span className="font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--ck-muted)]">
      {title}
    </span>
  );
  const drawerText = drawerLabel && (
    <span className="text-[11px] text-[var(--ck-faint)]">
      {collapsible ? (open ? '▾ ' : '▸ ') : ''}
      {drawerLabel}
    </span>
  );
  const rowClass =
    'flex w-full items-center justify-between border-b border-[var(--ck-line)] px-4 py-3 text-start';

  return (
    <section className="engagement-cockpit overflow-hidden rounded-[14px] border border-[var(--ck-line)] bg-[var(--ck-surface)] text-[var(--ck-ink)] shadow-sm">
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
