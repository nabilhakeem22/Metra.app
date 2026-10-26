'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Row } from '@/components/share/link-page-parts';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { formatMoney } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';

/**
 * A client's contract figures, on /c and in the client home. An execution
 * contract (from a BOQ) shows how its value is built: the works, VAT and the
 * supervision fee. It carries no advance or retention percentage (plan A5):
 * the schedule card says how it is paid. `flat` as for the section list.
 */
export function ContractTotalsCard({ contract, flat = false }: { contract: ContractDocument; flat?: boolean }) {
  const t = useTranslations('portal.contract.totals');
  const locale = useLocale();
  const m = (value: string) => formatMoney(value, locale);
  const pct = (value: string) => formatPercent(value, locale);

  return (
    <Card flat={flat}>
      <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-body">
        {contract.source === 'boq' ? (
          <>
            <Row label={t('worksValue')} value={m(contract.taxable_base)} />
            <Row label={t('vat', { rate: pct(contract.tax_rate) })} value={m(contract.tax_amount)} />
            <Row label={t('supervision', { rate: pct(contract.supervision_pct) })} value={m(contract.supervision_amount)} />
            <Row label={t('originalValue')} value={m(contract.total)} bold />
          </>
        ) : (
          <>
            <Row label={t('originalValue')} value={m(contract.total)} bold />
            <Row label={t('advancePct')} value={pct(contract.advance_pct)} />
            <Row label={t('retentionPct')} value={pct(contract.retention_pct)} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
