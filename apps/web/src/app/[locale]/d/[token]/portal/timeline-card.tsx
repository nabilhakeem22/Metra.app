'use client';

import { CircleCheck, CircleDot, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PortalTimelineEntry, PublicDelivery } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { useTimelineLine } from './use-timeline-line';

/** How many entries show before "Show all". */
export const TIMELINE_VISIBLE = 6;

const ICON = { stage: CircleDot, decision: CircleCheck, payment: Wallet } as const;

/**
 * "What happened": the delivery's dated story, newest first, in the order the
 * database gives it (a stage move above the decision that caused it). The
 * newest six, then "Show all". Dates are Cairo days, Latin digits. A decision
 * the studio recorded for the client says so. Nothing when there is no story
 * yet. 44 px toggle.
 */
export function TimelineCard({
  timeline,
  lastUpdateAt,
}: {
  timeline: PublicDelivery['timeline'];
  lastUpdateAt: PublicDelivery['lastUpdateAt'];
}) {
  const t = useTranslations('delivery.timeline');
  const locale = useLocale();
  const lineOf = useTimelineLine();
  const [showAll, setShowAll] = useState(false);
  if (timeline.length === 0) return null;
  const shown: readonly PortalTimelineEntry[] = showAll ? timeline : timeline.slice(0, TIMELINE_VISIBLE);
  const date = (instant: string) => bidiIsolate(formatDate(instant, locale));

  return (
    <section aria-labelledby="timeline-title" className="space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timeline-title" className="text-body font-semibold">
          {t('title')}
        </h2>
        {lastUpdateAt && <span className="text-caption text-muted-foreground">{t('lastUpdate', { date: date(lastUpdateAt) })}</span>}
      </div>
      <ol className="space-y-2.5">
        {shown.map((entry, index) => {
          const Icon = ICON[entry.type];
          return (
            <li key={`${entry.type}-${entry.at}-${index}`} className="grid grid-cols-[1rem_1fr] gap-2.5">
              <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-body">{lineOf(entry)}</p>
                <p className="text-caption text-muted-foreground">{date(entry.at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {timeline.length > TIMELINE_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
          className="inline-flex min-h-11 items-center rounded-pill border px-4 text-caption font-semibold outline-none focus-ring-brand hover:bg-muted"
        >
          {showAll ? t('showFewer') : t('showAll', { count: timeline.length })}
        </button>
      )}
    </section>
  );
}
