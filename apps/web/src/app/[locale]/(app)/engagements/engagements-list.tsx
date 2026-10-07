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

/** From `sm` up, a row is four columns under the header. */
const ROW_GRID =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_96px] sm:items-center sm:gap-x-4 sm:gap-y-2';

/**
 * The deliveries register. EACH ROW IS ONE LINK (one tab stop, the whole row is
 * the target), mirroring the dashboard's deliveries panel: it says what the
 * delivery is, its stage in words, its status (the delivery page's own rule:
 * whose move it is) and how long since it last changed. Below `sm` each row is a
 * stacked card instead (title, client and project, status, stage, age), since
 * four columns do not fit a phone.
 */
export function EngagementsList({ items, now }: { items: EngagementListRow[]; now: Date }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const nameOf = (nameAr: string | null, nameEn: string | null) =>
    pickLocale({ nameAr, nameEn }, 'name', locale).value || '—';

  return (
    <div>
      <div
        className={`${ROW_GRID} hidden border-b px-4 py-2 text-caption font-medium text-muted-foreground`}
      >
        <span>{t('engagement')}</span>
        <span>{t('list.stage')}</span>
        <span>{t('list.status')}</span>
        <span className="text-end">{t('list.lastChange')}</span>
      </div>
      <ul className="space-y-2 p-2 sm:space-y-0 sm:p-0">
        {items.map((row) => {
          // ONE status per row: the chip and the age colour read the same one.
          const status = deliveryStatusAsOf(row, now);
          return (
            <li
              key={row.id}
              className="rounded-item border sm:rounded-none sm:border-0 sm:border-b sm:last:border-0"
            >
              <Link
                href={`/engagements/${row.id}`}
                data-delivery-row
                className={`${ROW_GRID} flex flex-col gap-1.5 p-3 text-body hover:bg-muted/40 focus-visible:bg-muted/40 sm:px-4`}
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
                <span className="order-3 min-w-0 sm:order-none">
                  <StateBadge state={row.state} showStage />
                </span>
                <span className="order-2 sm:order-none">
                  <DeliveryStatusChip status={status} />
                </span>
                <span className="order-4 text-start sm:order-none sm:text-end">
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
