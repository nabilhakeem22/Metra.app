'use client';

import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EXECUTION_LIST_CAP, type PortalExecutionReceipt } from '@/lib/engagements/public/execution-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { DocumentNumber } from './document-number';
import type { PortalListMoney } from './portal-money';

/**
 * The money the studio recorded as received on the execution contract, newest
 * first (same-day payments by when the studio recorded them): on which day,
 * for which payment request, and how much. The request's number never breaks
 * across lines, in either direction (B4 F5). Only the newest 60 travel; when
 * there are more, a note says so. Nothing when nothing was received. Amounts
 * keep the decimals rule of the payments they are listed with (`money`).
 */
export function ExecutionReceipts({
  receipts,
  truncated,
  money,
}: {
  receipts: readonly PortalExecutionReceipt[];
  truncated: boolean;
  money: PortalListMoney;
}) {
  const t = useTranslations('delivery.execution.receipts');
  const locale = useLocale();
  if (receipts.length === 0) return null;

  return (
    <section aria-labelledby="execution-receipts-title" className="space-y-1">
      <h3 id="execution-receipts-title" className="text-caption font-semibold text-muted-foreground">
        {t('title')}
      </h3>
      <ul>
        {receipts.map((receipt, index) => (
          <li
            key={`${receipt.receivedOn}-${receipt.requestNumber}-${index}`}
            className="grid grid-cols-[1rem_1fr_auto] items-start gap-2 border-t py-2 first:border-t-0"
          >
            <CheckCircle2 className="mt-0.5 size-4 text-[color:var(--success)]" aria-hidden />
            <p className="min-w-0 text-caption text-muted-foreground">
              {t.rich('receivedOn', {
                date: bidiIsolate(formatDate(receipt.receivedOn, locale)),
                request: receipt.requestNumber,
                num: (chunks) => <DocumentNumber>{chunks}</DocumentNumber>,
              })}
            </p>
            <span dir="ltr" className="text-end font-mono text-body font-semibold tabular-nums">
              {money(receipt.amount)}
            </span>
          </li>
        ))}
      </ul>
      {truncated && <p className="text-caption text-muted-foreground">{t('truncated', { count: String(EXECUTION_LIST_CAP) })}</p>}
    </section>
  );
}
