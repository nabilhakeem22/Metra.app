'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { resolveBudgetBadge } from '@/lib/engagements/budget-badge';
import { landedKeysOf } from '@/lib/engagements/held-key';
import { countConceptOptions } from '@/lib/engagements/concept-options';
import { EngagementCommandCard } from './engagement-command-card';
import type { EngagementDetailProps } from './engagement-detail-props';
import { EngagementPanels } from './engagement-panels';
import { EngagementTabStrip } from './engagement-tab-strip';
import { revealDeliveryShareLink } from './share-anchor';
import type { EngagementTab } from './tabs';
import { useEngagementAction } from './use-engagement-action';

// The cockpit's single-column body: the COMMAND CARD (what's next) on top, then
// the tabbed DETAIL region (Files · Timeline · Payments · Change orders — Files
// default). The old right rail is dissolved: its working files, fee ledger and
// activity now live inside those tabs, and so does every action that writes into
// them — the 'Log & manage' strip that used to sit here offered four equal
// choices an inch under a card whose whole premise is naming ONE next move. Each
// of those four now lives in the header of the tab holding its record. Pure
// composition over data the page already loaded; logical CSS only (RTL mirrors).
export function EngagementDetailClient({
  header,
  boqSummary,
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
  awaitingReplyCount,
}: EngagementDetailProps) {
  const t = useTranslations('engagements');
  const te = useTranslations('errors');
  const [tab, setTab] = useState<EngagementTab>('files');
  const { pending, error, runAction } = useEngagementAction({
    engagementId: header.id,
    // The engagement's own records, so a key held for an attempt the studio was
    // never told the outcome of is dropped once a row CARRIES that key. Both
    // ledgers: a transition writes one, and so does a payment.
    landedKeys: landedKeysOf(transitions, payments),
  });
  // The Advance button owns the forward-advance trigger; every OTHER legal,
  // permitted trigger becomes a low-emphasis secondary control (no legal trigger
  // is dropped — Advance ∪ secondary = the capability-filtered legal set).
  const secondaryTriggers = nextActions.filter(
    (trigger) => trigger !== gatePreview.primaryTrigger,
  );

  // Derived from data the page already holds; the rule itself lives in
  // lib/engagements/budget-badge.ts, where it can be tested.
  const budgetBadge = resolveBudgetBadge(header, events);

  // Pure derivation over the artifacts the page already loaded (no extra read).
  // The command card needs it to stop offering a 5th concept-option upload —
  // artifacts are append-only, so overshooting the guard's cap is unrecoverable.
  const conceptOptionCount = countConceptOptions(artifacts);

  return (
    <div className="space-y-4">
      <Link href="/engagements" className="text-sm text-primary hover:underline">
        {t('backToList')}
      </Link>

      <EngagementCommandCard
        engagementId={header.id}
        projectId={header.projectId}
        boqSummary={boqSummary}
        preview={gatePreview}
        state={header.state}
        allowances={{
          revisionCount: header.revisionCount,
          freeRevisionN: header.freeRevisionN,
          designRevisionCount: header.designRevisionCount,
          freeDesignRevisionN: header.freeDesignRevisionN,
        }}
        stallDays={stallDays}
        canAdvance={canAdvance}
        canRecordPayment={capabilities.recordPayment}
        canShare={canShare}
        canUpload={canUpload}
        canSetOffPlan={capabilities.setRom}
        offPlan={header.offPlan}
        paymentClaimCount={paymentClaimCount}
        awaitingReplyCount={awaitingReplyCount}
        conceptOptionCount={conceptOptionCount}
        clientActivity={clientActivity}
        secondaryTriggers={secondaryTriggers}
        pending={pending}
        runAction={runAction}
        onNudge={revealDeliveryShareLink}
      />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {resolveActionError(error, te)}
        </p>
      )}

      <EngagementTabStrip
        tab={tab}
        onSelect={setTab}
        paymentClaimCount={paymentClaimCount}
        awaitingReplyCount={awaitingReplyCount}
        budget={budgetBadge}
        pending={pending}
      />

      <EngagementPanels
        tab={tab}
        engagementId={header.id}
        canUpload={canUpload}
        capabilities={capabilities}
        pending={pending}
        runAction={runAction}
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
