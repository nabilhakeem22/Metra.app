'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EngagementClientActivityRecord } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { Empty } from './engagement-panels-parts';

/**
 * The cockpit "Client activity" panel — the studio's view of the client's own
 * append-only portal signals (approvals, change-requests, acknowledgements),
 * NEWEST FIRST. Read-only: these are advisory witnesses, not state moves. A
 * `rom_acknowledgement` shows the acknowledged budget band. Logical CSS only so it
 * mirrors in ar-EG RTL; money is `font-mono tabular-nums`, `dir=ltr`.
 */
export function ClientActivityPanel({
  activity,
}: {
  activity: EngagementClientActivityRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (activity.length === 0) return <Empty text={t('clientActivity.empty')} />;
  return (
    <ul className="m-0 list-none p-0">
      {activity.map((entry, index) => (
        <li
          key={`${entry.kind}-${index}`}
          className="border-b border-dashed border-[color:var(--rule)] py-2.5 last:border-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium">
              {t(`eventKind.${entry.kind}`)}
            </span>
            <span
              className="font-mono text-[11px] text-[color:var(--text-faint)]"
              dir="ltr"
            >
              {formatDate(entry.decidedAt, locale)}
            </span>
          </div>
          {entry.actorName && (
            <div className="text-[12px] text-[color:var(--text-muted)]">
              {t('clientActivity.by', { name: entry.actorName })}
            </div>
          )}
          {entry.rangeLow && entry.rangeHigh && (
            <div
              className="mt-0.5 font-mono text-[12px] text-[color:var(--text-muted)] tabular-nums"
              dir="ltr"
            >
              {formatMoney(entry.rangeLow, locale)} – {formatMoney(entry.rangeHigh, locale)}
            </div>
          )}
          {entry.note && (
            <p className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
              {entry.note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
