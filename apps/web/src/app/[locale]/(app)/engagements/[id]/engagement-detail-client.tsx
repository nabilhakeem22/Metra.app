'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type {
  EngagementArtifactRecord,
  EngagementChangeOrderRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import type { Trigger } from '@/lib/engagements/transitions';
import {
  EngagementControls,
  type ControlCapabilities,
} from './engagement-controls';
import { EngagementHeaderCard } from './engagement-header-card';
import { EngagementHero } from './engagement-hero';
import { EngagementNextActions } from './engagement-next-actions';
import { EngagementPanels } from './engagement-panels';
import { EngagementPhaseRail } from './engagement-phase-rail';
import { ENGAGEMENT_TABS, type EngagementTab } from './tabs';

export function EngagementDetailClient({
  header,
  feeSchedule,
  payments,
  artifacts,
  events,
  changeOrders,
  transitions,
  nextActions,
  capabilities,
  gatePreview,
  canAdvance,
  stallDays,
}: {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  nextActions: Trigger[];
  capabilities: ControlCapabilities;
  gatePreview: EngagementGatePreview;
  canAdvance: boolean;
  stallDays: number | null;
}) {
  const t = useTranslations('engagements');
  const te = useTranslations('errors');
  const tp = useTranslations('engagements.panels');
  const router = useRouter();
  const [tab, setTab] = useState<EngagementTab>('fee');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionCode | null>(null);
  const dataEntryRef = useRef<HTMLDivElement>(null);

  function runAction(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError((res.error as ActionCode) ?? 'generic');
    });
  }

  function scrollToDataEntry() {
    dataEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-4">
      <Link href="/engagements" className="text-sm text-primary hover:underline">
        {t('backToList')}
      </Link>

      <EngagementPhaseRail
        currentState={header.state}
        revisionCount={header.revisionCount}
      />

      <EngagementHero
        engagementId={header.id}
        preview={gatePreview}
        state={header.state}
        revisionCount={header.revisionCount}
        freeRevisionN={header.freeRevisionN}
        stallDays={stallDays}
        canAdvance={canAdvance}
        canRecordPayment={capabilities.recordPayment}
        pending={pending}
        runAction={runAction}
        onRecordSomethingElse={scrollToDataEntry}
      />

      <EngagementHeaderCard header={header} />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {resolveActionError(error, te)}
        </p>
      )}

      <EngagementNextActions
        engagementId={header.id}
        triggers={nextActions}
        pending={pending}
        runAction={runAction}
      />

      <div ref={dataEntryRef}>
        <EngagementControls
          engagementId={header.id}
          capabilities={capabilities}
          pending={pending}
          runAction={runAction}
        />
      </div>

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
  );
}
