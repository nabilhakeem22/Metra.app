'use client';

import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PortalTimelineEntry } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { formatPortalMoney } from './portal-money';
import { useMilestoneLabel } from './use-milestone-label';

type PaymentEntry = Extract<PortalTimelineEntry, { type: 'payment' }>;

/**
 * The money the studio has received from the client, newest first: which
 * payment, on which day (Cairo), and how much. From the timeline's payment
 * entries, so the page tells one story. Money per the Money law: Latin digits,
 * left to right, monospace, tabular, at the row's end. Nothing when nothing
 * was received.
 */
export function PaymentReceipts({ timeline }: { timeline: readonly PortalTimelineEntry[] }) {
  const t = useTranslations('delivery.payments.receipts');
  const locale = useLocale();
  const milestoneLabel = useMilestoneLabel();
  const receipts = timeline.filter((entry): entry is PaymentEntry => entry.type === 'payment');
  if (receipts.length === 0) return null;

  return (
    <section aria-labelledby="payment-receipts-title" className="space-y-1">
      <h3 id="payment-receipts-title" className="text-caption font-semibold text-muted-foreground">
        {t('title')}
      </h3>
      <ul>
        {receipts.map((receipt, index) => (
          <li
            key={`${receipt.at}-${receipt.kind}-${index}`}
            className="grid grid-cols-[1rem_1fr_auto] items-start gap-2 border-t py-2 first:border-t-0"
          >
            <CheckCircle2 className="mt-0.5 size-4 text-[color:var(--success)]" aria-hidden />
            <div className="min-w-0">
              <p className="text-body font-medium">{milestoneLabel(receipt.kind)}</p>
              <p className="text-caption text-muted-foreground">
                {t('receivedOn', { date: bidiIsolate(formatDate(receipt.at, locale)) })}
              </p>
            </div>
            <span dir="ltr" className="text-end font-mono text-body font-semibold tabular-nums">
              {formatPortalMoney(receipt.amount, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
