import { useLocale, useTranslations } from 'next-intl';
import { daysSince } from '@/lib/engagements/delivery-age';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { formatNumber } from '@/lib/format/number';

// NOT 'use client': rendered by the dashboard panel (server) and the deliveries
// list (client) alike.

/**
 * How long a delivery has sat since its last change. `now` is passed in so a
 * page renders one consistent "today" for every row (and the server and the
 * browser agree on it).
 *
 * The age is called out (amber, bold) ONLY when the delivery's status is
 * `stalled`, the same resolver the chip beside it reads: the client has held it
 * a week or more. Age alone is not the rule. The studio's own move, a payment
 * to confirm and a closed delivery stay muted however old they are, or the row
 * would say "your move" and "stalled" at once.
 */
export function DeliveryAgeLabel({
  updatedAt,
  now,
  status,
}: {
  updatedAt: string;
  now: Date;
  status: DeliveryStatus;
}) {
  const t = useTranslations('engagements.age');
  const locale = useLocale();
  const days = daysSince(updatedAt, now);
  const stale = status.kind === 'stalled';
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
