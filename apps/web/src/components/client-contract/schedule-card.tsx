'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { milestoneAmounts } from '@/lib/execution/money/milestone-amounts';
import { formatMoney } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';

/**
 * The payment schedule the client signs with the contract, on /c and in the
 * client home, each row with what it bills: the SAME `milestoneAmounts` the
 * payment requests are issued with, on the contract value, the last row taking
 * the rounding remainder. A row's share keeps its distance from its amount,
 * an amount never breaks from its currency, and a long unbroken label breaks
 * rather than scroll the page sideways. `flat` as for the section list.
 */
export function ContractScheduleCard({ contract, flat = false }: { contract: ContractDocument; flat?: boolean }) {
  const t = useTranslations('portal.contract.schedule');
  const locale = useLocale();
  const rows = contract.payment_schedule.map((row) => ({
    labelAr: row.label_ar,
    labelEn: row.label_en,
    basis: row.basis,
    value: row.value,
    sortOrder: row.sort_order,
  }));
  if (rows.length === 0) return null;
  const amounts = milestoneAmounts(rows, contract.original_value, contract.tax_amount);

  return (
    <Card flat={flat}>
      <CardContent className="space-y-2 py-4">
        <h2 className="text-body font-semibold">{t('title')}</h2>
        <table className="w-full text-body">
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.sortOrder} className="border-b last:border-0">
                <td className="py-2 [overflow-wrap:anywhere]">{pickLocale(row, 'label', locale).value}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" dir="ltr">
                  {row.basis === 'percent' ? formatPercent(row.value, locale) : null}
                </td>
                <td className="whitespace-nowrap py-2 text-end font-mono tabular-nums" dir="ltr">
                  {formatMoney(amounts[index].amount, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-caption text-muted-foreground">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
