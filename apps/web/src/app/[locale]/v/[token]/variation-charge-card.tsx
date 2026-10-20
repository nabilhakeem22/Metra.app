'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Row } from '@/components/share/link-page-parts';
import { Card, CardContent } from '@/components/ui/card';
import { variationCharge } from '@/lib/execution/money/variation-charge';
import { formatNumber } from '@/lib/format/number';
import type { PublicVariation } from '@/lib/variations/public';

/**
 * What the order costs the client and the time it adds. An execution
 * contract's order shows its works, VAT, supervision and total (D4a); a
 * proposal contract's shows the net change alone, as before Stage 2. The days
 * it adds to the finish date are said when it adds any.
 */
export function VariationChargeCard({
  variation,
  m,
}: {
  variation: Pick<PublicVariation, 'net_delta' | 'charges' | 'timeExtensionDays'>;
  m: (value: string) => string;
}) {
  const t = useTranslations('variations.client');
  const locale = useLocale();
  const days = variation.timeExtensionDays;
  const charge = variation.charges
    ? variationCharge(variation.net_delta, variation.charges.taxRate, variation.charges.supervisionPct)
    : null;

  return (
    <Card>
      <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-body">
        {charge ? (
          <>
            <Row label={t('charge.works')} value={m(charge.works)} />
            <Row label={t('charge.tax')} value={m(charge.tax)} />
            <Row label={t('charge.supervision')} value={m(charge.supervision)} />
            <Row label={t('charge.total')} value={m(charge.total)} bold />
          </>
        ) : (
          <Row label={t('netDelta')} value={m(variation.net_delta)} bold />
        )}
        {days !== null && days > 0 && (
          <p className="text-muted-foreground">{t('charge.addsDays', { count: days, n: formatNumber(days, locale) })}</p>
        )}
      </CardContent>
    </Card>
  );
}
