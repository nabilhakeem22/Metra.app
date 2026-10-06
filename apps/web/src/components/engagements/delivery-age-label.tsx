import { useLocale, useTranslations } from 'next-intl';
import { daysSince, isStale } from '@/lib/engagements/delivery-age';
import { formatNumber } from '@/lib/format/number';

// NOT 'use client': rendered by the dashboard panel (server) and the deliveries
// list (client) alike.

/**
 * How long a delivery has sat since its last change. `now` is passed in so a
 * page renders one consistent "today" for every row (and the server and the
 * browser agree on it). A closed delivery is never called out as stale: it is
 * finished, not stuck.
 */
export function DeliveryAgeLabel({
  updatedAt,
  now,
  closed = false,
}: {
  updatedAt: string;
  now: Date;
  closed?: boolean;
}) {
  const t = useTranslations('engagements.age');
  const locale = useLocale();
  const days = daysSince(updatedAt, now);
  const stale = !closed && isStale(days);
  return (
    <span
      className={`whitespace-nowrap text-end text-caption tabular-nums ${
        stale
          ? 'font-bold text-[color:var(--warn)]'
          : 'text-[color:var(--text-muted)]'
      }`}
    >
      {days === 0
        ? t('today')
        : /* The count drives the plural; the DISPLAYED number is pre-formatted,
             because next-intl is configured with a bare `ar-EG` locale and ICU's
             `#` would render Arabic-Indic digits (lib/format/number.ts). */
          t('sinceDays', { count: days, n: formatNumber(days, locale) })}
    </span>
  );
}
