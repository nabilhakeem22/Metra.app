'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
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
import type { CommercialPulse } from '@/lib/engagements/pulse';
import type { Trigger } from '@/lib/engagements/transitions';
import { EngagementCommandCard } from './engagement-command-card';
import { EngagementMiniRail } from './engagement-mini-rail';
import { EngagementPanels } from './engagement-panels';
import { EngagementPhaseRail } from './engagement-phase-rail';
import { EngagementPulseBar } from './engagement-pulse-bar';
import { EngagementRightRail } from './engagement-right-rail';
import { EngagementToolbar, type ToolbarCapabilities } from './engagement-toolbar';
import { ENGAGEMENT_TABS, type EngagementTab } from './tabs';
import { DELIVERY_SHARE_ANCHOR_ID } from './share-anchor';

export function EngagementDetailClient({
  header,
  feeSchedule,
  payments,
  artifacts,
  events,
  changeOrders,
  transitions,
  clientActivity,
  nextActions,
  capabilities,
  canUpload,
  canShare,
  gatePreview,
  canAdvance,
  stallDays,
  pulse,
}: {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  clientActivity: EngagementClientActivityRecord[];
  nextActions: Trigger[];
  capabilities: ToolbarCapabilities;
  canUpload: boolean;
  canShare: boolean;
  gatePreview: EngagementGatePreview;
  canAdvance: boolean;
  stallDays: number | null;
  pulse: CommercialPulse;
}) {
  const t = useTranslations('engagements');
  const te = useTranslations('errors');
  const tp = useTranslations('engagements.panels');
  const router = useRouter();
  const [tab, setTab] = useState<EngagementTab>('payments');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionCode | null>(null);

  // The Advance button owns the forward-advance trigger; every OTHER legal,
  // permitted trigger becomes a low-emphasis secondary control (no legal trigger
  // is dropped — Advance ∪ secondary = the capability-filtered legal set).
  const secondaryTriggers = nextActions.filter(
    (trigger) => trigger !== gatePreview.primaryTrigger,
  );

  function runAction(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError((res.error as ActionCode) ?? 'generic');
    });
  }

  // Nudge = reveal the EXISTING client link. Scroll to (and focus) the delivery
  // share control rendered by the page above — no new server action, no notify.
  function revealShareLink() {
    const el = document.getElementById(DELIVERY_SHARE_ANCHOR_ID);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus?.();
  }

  return (
    <div className="space-y-4">
      <Link href="/engagements" className="text-sm text-primary hover:underline">
        {t('backToList')}
      </Link>

      <EngagementPulseBar pulse={pulse} />

      <EngagementPhaseRail
        currentState={header.state}
        revisionCount={header.revisionCount}
      />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        {/* LEFT: action-over-history — the command card + the fuller detail below. */}
        <div className="min-w-0 space-y-4">
          <EngagementCommandCard
            engagementId={header.id}
            preview={gatePreview}
            state={header.state}
            revisionCount={header.revisionCount}
            freeRevisionN={header.freeRevisionN}
            stallDays={stallDays}
            canAdvance={canAdvance}
            canRecordPayment={capabilities.recordPayment}
            canShare={canShare}
            secondaryTriggers={secondaryTriggers}
            pending={pending}
            runAction={runAction}
            onNudge={revealShareLink}
          />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {resolveActionError(error, te)}
            </p>
          )}

          <EngagementToolbar
            engagementId={header.id}
            capabilities={capabilities}
            pending={pending}
            runAction={runAction}
          />

          <EngagementMiniRail
            clientActivity={clientActivity}
            changeOrders={changeOrders}
          />

          <div className="flex flex-wrap gap-2 border-b">
            {ENGAGEMENT_TABS.map((tb) => (
              <button
                key={tb}
                type="button"
                onClick={() => setTab(tb)}
                className={`border-b-2 px-3 py-2 text-sm ${
                  tab === tb
                    ? 'border-primary font-medium'
                    : 'border-transparent text-muted-foreground'
                }`}
              >
                {tp(tb)}
              </button>
            ))}
          </div>

          <EngagementPanels
            tab={tab}
            data={{
              header,
              feeSchedule,
              payments,
              artifacts,
              events,
              changeOrders,
              transitions,
            }}
          />
        </div>

        {/* RIGHT RAIL: working files → fee/payment schedule → recent activity. */}
        <EngagementRightRail
          engagementId={header.id}
          artifacts={artifacts}
          canUpload={canUpload}
          feeSchedule={feeSchedule}
          transitions={transitions}
          events={events}
        />
      </div>
    </div>
  );
}
