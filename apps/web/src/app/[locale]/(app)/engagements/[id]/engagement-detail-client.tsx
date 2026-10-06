'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { resolveBudgetBadge } from '@/lib/engagements/budget-badge';
import { landedKeysOf } from '@/lib/engagements/held-key';
import { isTerminal } from '@/lib/engagements/states';
import { commandCardPropsOf } from './command-card-props-of';
import { EngagementCommandCard } from './engagement-command-card';
import type { EngagementDetailProps } from './engagement-detail-props';
import { EngagementPanels } from './engagement-panels';
import { EngagementTabStrip } from './engagement-tab-strip';
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
export function EngagementDetailClient(props: EngagementDetailProps) {
  const {
    header,
    feeSchedule,
    payments,
    artifacts,
    events,
    changeOrders,
    transitions,
    clientActivity,
    capabilities,
    canUpload,
    pulse,
    paymentClaims,
    awaitingReplyCount,
  } = props;
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
  // Derived from data the page already holds; the rule itself lives in
  // lib/engagements/budget-badge.ts, where it can be tested.
  const budgetBadge = resolveBudgetBadge(header, events);

  return (
    <div className="space-y-4">
      <Link href="/engagements" className="text-body text-primary hover:underline">
        {t('backToList')}
      </Link>

      <EngagementCommandCard {...commandCardPropsOf(props, { pending, runAction })} />

      {error && (
        <p className="text-body text-destructive" role="alert">
          {resolveActionError(error, te)}
        </p>
      )}

      <EngagementTabStrip
        tab={tab}
        onSelect={setTab}
        paymentClaimCount={paymentClaims.length}
        awaitingReplyCount={awaitingReplyCount}
        budget={budgetBadge}
        closed={isTerminal(header.state)}
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
