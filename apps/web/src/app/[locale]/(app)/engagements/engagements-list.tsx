'use client';

import { useLocale, useTranslations } from 'next-intl';
import { DeliveryAgeLabel } from '@/components/engagements/delivery-age-label';
import { DeliveryStatusChip } from '@/components/engagements/delivery-status-chip';
import { Link } from '@/i18n/routing';
import { deliveryStatusAsOf } from '@/lib/engagements/delivery-status';
import type { EngagementListRow } from '@/lib/engagements/queries';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { StateBadge } from './state-badge';

const ROW_GRID =
  'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_96px]';

/**
 * The deliveries register. EACH ROW IS ONE LINK (one tab stop, the whole row is
 * the target), mirroring the dashboard's deliveries panel: it says what the
 * delivery is, its stage in words, its status (the delivery page's own rule:
 * whose move it is) and how long since it last changed.
 */
export function EngagementsList({ items, now }: { items: EngagementListRow[]; now: Date }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const nameOf = (nameAr: string | null, nameEn: string | null) =>
    pickLocale({ nameAr, nameEn }, 'name', locale).value || '—';

  return (
    <div>
      <div
        className={`${ROW_GRID} hidden border-b px-4 py-2 text-caption font-medium text-muted-foreground sm:grid`}
      >
        <span>{t('engagement')}</span>
        <span>{t('list.stage')}</span>
        <span>{t('list.status')}</span>
        <span className="text-end">{t('list.lastChange')}</span>
      </div>
      <ul>
        {items.map((row) => {
          // ONE status per row: the chip and the age colour read the same one.
          const status = deliveryStatusAsOf(row, now);
          return (
            <li key={row.id} className="border-b last:border-0">
              <Link
                href={`/engagements/${row.id}`}
                className={`${ROW_GRID} px-4 py-3 text-body hover:bg-muted/40 focus-visible:bg-muted/40`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    <bdi>{nameOf(row.titleAr, row.titleEn)}</bdi>
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    <span className="font-mono" dir="ltr">
                      {formatDocNumber('DE', row.number, docYear(null, row.createdAt))}
                    </span>
                    <span aria-hidden> · </span>
                    <span dir="auto">{nameOf(row.clientNameAr, row.clientNameEn)}</span>
                    <span aria-hidden> · </span>
                    <span dir="auto">{nameOf(row.projectNameAr, row.projectNameEn)}</span>
                  </span>
                </span>
                <span className="min-w-0">
                  <StateBadge state={row.state} showStage />
                </span>
                <span>
                  <DeliveryStatusChip status={status} />
                </span>
                <span className="text-end">
                  <DeliveryAgeLabel updatedAt={row.updatedAt} now={now} status={status} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
