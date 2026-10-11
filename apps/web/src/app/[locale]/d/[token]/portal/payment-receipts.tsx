'use client';

import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { RECEIPTS_MAX_ENTRIES } from '@/lib/engagements/public/receipt-rows';
import type { PortalReceipt } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { formatPortalMoney } from './portal-money';
import { useMilestoneLabel } from './use-milestone-label';

/**
 * The money the studio has received from the client, newest first: which
 * payment, on which day (Cairo), and how much. From the snapshot's own
 * receipts list (Round D), so a payment never drops off behind newer stage
 * moves on the 60-entry timeline; when the delivery has more than that list
 * carries, a note says only the latest are shown. Money per the Money law:
 * Latin digits, left to right, monospace, tabular, at the row's end. Nothing
 * when nothing was received.
 */
export function PaymentReceipts({
  receipts,
  truncated,
}: {
  receipts: readonly PortalReceipt[];
  /** The delivery has more payments than `receipts` carries. */
  truncated: boolean;
}) {
  const t = useTranslations('delivery.payments.receipts');
  const locale = useLocale();
  const milestoneLabel = useMilestoneLabel();
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
      {truncated && (
        <p className="text-caption text-muted-foreground">{t('truncated', { count: String(RECEIPTS_MAX_ENTRIES) })}</p>
      )}
    </section>
  );
}
