'use client';

import { ChevronDown, CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import type { DesignSummary } from '@/lib/engagements/design-summary';
import { formatNumber } from '@/lib/format/number';
import { EngagementStageSpine } from './engagement-stage-spine';
import type { EngagementTab } from './tabs';

/** The figures, in the order the line says them. */
const FIGURES: readonly (keyof DesignSummary)[] = ['openInstalments', 'pendingClaims', 'awaitingReply'];

/** The tabs the expanded line points at: where the design's record lives. */
const RECORD_TABS: readonly EngagementTab[] = ['files', 'payments', 'timeline'];

// The DESIGN SUMMARY LINE: once the delivery is at `execution`, the finished
// design folds into one line above the execution rail, "Design: complete" plus
// whatever is still open on it. Expanding shows the design rail (every step
// done), all three figures and the tabs that hold their rows. Nothing here
// reads or writes: the figures arrive counted (lib/engagements/design-summary.ts).
export function DesignSummaryLine({
  summary,
  status,
  pending,
  onOpenTab,
}: {
  summary: DesignSummary;
  /** The delivery's status, for the design rail. */
  status: DeliveryStatus;
  /** A write is in flight: the tabs are locked, so the links to them are too. */
  pending: boolean;
  onOpenTab: (tab: EngagementTab) => void;
}) {
  const t = useTranslations('engagements.designSummary');
  const tp = useTranslations('engagements.panels');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const figure = (key: keyof DesignSummary) => t(key, { count: summary[key], n: formatNumber(summary[key], locale) });
  const openParts = FIGURES.filter((key) => summary[key] > 0);

  return (
    <div className="mb-4 border-b border-[color:var(--rule)] pb-3" data-design-summary>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-start text-small coarse:min-h-11"
      >
        <CircleCheck className="size-4 shrink-0 text-[color:var(--success)]" aria-hidden />
        <span className="font-semibold text-[color:var(--text)]">{t('complete')}</span>
        {openParts.map((key) => (
          <span key={key} className="font-semibold text-[color:var(--warn)]">
            <span aria-hidden className="me-2 font-normal text-[color:var(--text-faint)]">
              ·
            </span>
            {figure(key)}
          </span>
        ))}
        <span className="ms-auto inline-flex items-center gap-1 font-semibold text-[color:var(--text-muted)]">
          {open ? t('hide') : t('show')}
          <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>
      {open && (
        <div id={panelId} className="mt-3 space-y-3">
          <EngagementStageSpine state="execution" status={status} />
          <ul className="space-y-1 text-small text-[color:var(--text-muted)]">
            {FIGURES.map((key) => (
              <li key={key}>{figure(key)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-[color:var(--text-faint)]">{t('detailsIn')}</span>
            {RECORD_TABS.map((tab) => (
              <Button key={tab} type="button" variant="secondary" size="sm" disabled={pending} onClick={() => onOpenTab(tab)}>
                {tp(tab)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
