'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ContractPaymentsPage } from '@/lib/execution/payments/queries';
import { formatDate } from '@/lib/format/date';

/**
 * The money received on the contract, newest first, 50 rows at a time
 * ("show more" asks for the next page by keyset, so a long ledger never makes
 * the tab heavier than its first page).
 */
export function PaymentsLedger({
  payments,
  loading,
  m,
  onShowMore,
}: {
  payments: ContractPaymentsPage;
  loading: boolean;
  m: (value: string) => string;
  onShowMore: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.ledger');
  const locale = useLocale();

  return (
    <section className="space-y-2">
      <h3 className="text-body font-semibold">{t('title')}</h3>
      {payments.rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead className="text-caption text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pe-3 text-start font-medium">{t('receivedOn')}</th>
                <th className="py-2 pe-3 text-start font-medium">{t('request')}</th>
                {/* LTR like the amounts under it (the money law), so it sits over them on an Arabic page too. */}
                <th className="py-2 pe-3 text-end font-medium" dir="ltr">
                  {t('amount')}
                </th>
                <th className="py-2 text-start font-medium">{t('details')}</th>
              </tr>
            </thead>
            <tbody>
              {payments.rows.map((row) => (
                <tr key={row.id} className="border-b align-top last:border-0">
                  <td className="py-2 pe-3">{formatDate(row.receivedOn, locale)}</td>
                  <td className="py-2 pe-3 font-mono tabular-nums" dir="ltr">{row.requestNumber}</td>
                  <td className="py-2 pe-3 text-end font-mono tabular-nums" dir="ltr">{m(row.amount)}</td>
                  <td className="py-2 text-caption text-muted-foreground">
                    {[row.method, row.reference, row.note].filter(Boolean).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payments.nextCursor && (
        <Button variant="secondary" size="sm" disabled={loading} onClick={onShowMore}>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('more')}
        </Button>
      )}
    </section>
  );
}
