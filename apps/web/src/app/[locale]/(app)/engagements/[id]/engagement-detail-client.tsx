'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { countConceptOptions } from '@/lib/engagements/concept-options';
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
import { EngagementPanels } from './engagement-panels';
import { EngagementToolbar, type ToolbarCapabilities } from './engagement-toolbar';
import { ENGAGEMENT_TABS, type EngagementTab } from './tabs';
import { DELIVERY_SHARE_ANCHOR_ID } from './share-anchor';

// The cockpit's single-column body: the COMMAND CARD (what's next) on top, the
// studio's data-entry TOOLBAR, then the tabbed DETAIL region (Files · Timeline ·
// Payments · Change orders — Files default). The old right rail is dissolved: its
// working files, fee ledger and activity now live inside those tabs. Pure
// composition over data the page already loaded; logical CSS only (RTL mirrors).
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
  paymentClaimCount,
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
  paymentClaimCount: number;
}) {
  const t = useTranslations('engagements');
  const te = useTranslations('errors');
  const tp = useTranslations('engagements.panels');
  const router = useRouter();
  const [tab, setTab] = useState<EngagementTab>('files');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionCode | null>(null);

  // The Advance button owns the forward-advance trigger; every OTHER legal,
  // permitted trigger becomes a low-emphasis secondary control (no legal trigger
  // is dropped — Advance ∪ secondary = the capability-filtered legal set).
  const secondaryTriggers = nextActions.filter(
    (trigger) => trigger !== gatePreview.primaryTrigger,
  );

  // Pure derivation over the artifacts the page already loaded (no extra read).
  // The command card needs it to stop offering a 5th concept-option upload —
  // artifacts are append-only, so overshooting the guard's cap is unrecoverable.
  const conceptOptionCount = countConceptOptions(artifacts);

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
        canUpload={canUpload}
        canSetOffPlan={capabilities.setRom}
        offPlan={header.offPlan}
        paymentClaimCount={paymentClaimCount}
        conceptOptionCount={conceptOptionCount}
        clientActivity={clientActivity}
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

      <div className="flex flex-wrap gap-2 border-b">
        {ENGAGEMENT_TABS.map((tb) => {
          const badge = tb === 'payments' && paymentClaimCount > 0;
          return (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                tab === tb
                  ? 'border-primary font-medium'
                  : 'border-transparent text-muted-foreground'
              }`}
            >
              {tp(tb)}
              {badge && (
                <span
                  className="inline-flex items-center rounded-[var(--r-pill)] bg-[color:var(--warn-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]"
                  dir="ltr"
                >
                  {t('paymentsBadge', { n: paymentClaimCount })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <EngagementPanels
        tab={tab}
        engagementId={header.id}
        canUpload={canUpload}
        data={{
          header,
          feeSchedule,
          payments,
          artifacts,
          events,
          changeOrders,
          transitions,
          clientActivity,
          pulse,
        }}
      />
    </div>
  );
}
