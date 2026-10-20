'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Row } from '@/components/share/link-page-parts';
import { Card, CardContent } from '@/components/ui/card';
import { variationCharge } from '@/lib/execution/money/variation-charge';
import { formatMoneyExact } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import type { PublicVariation } from '@/lib/variations/public';
import { extensionDaysWording } from '@/lib/variations/time-extension';

/**
 * What the order costs the client and the time it adds. An execution
 * contract's order shows its works, VAT, supervision and total (D4a), each to
 * the exact piastre fraction so the rows add up to the total as shown (F4); a
 * proposal contract's shows the net change alone, as before Stage 2. The days
 * are worded by where the order stands (F2): `standing` is its status while
 * open, 'approved' once approved, and null when it closed any other way.
 */
export function VariationChargeCard({
  variation,
  standing,
  m,
}: {
  variation: Pick<PublicVariation, 'net_delta' | 'charges' | 'timeExtensionDays'>;
  standing: string | null;
  m: (value: string) => string;
}) {
  const t = useTranslations('variations.client');
  const locale = useLocale();
  const days = variation.timeExtensionDays;
  const wording = standing === null ? null : extensionDaysWording(standing, days);
  const charge = variation.charges
    ? variationCharge(variation.net_delta, variation.charges.taxRate, variation.charges.supervisionPct)
    : null;
  const exact = (value: string) => formatMoneyExact(value, locale);

  return (
    <Card>
      <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-body">
        {charge ? (
          <>
            <Row label={t('charge.works')} value={exact(charge.works)} />
            <Row label={t('charge.tax')} value={exact(charge.tax)} />
            <Row label={t('charge.supervision')} value={exact(charge.supervision)} />
            <Row label={t('charge.total')} value={exact(charge.total)} bold />
          </>
        ) : (
          <Row label={t('netDelta')} value={m(variation.net_delta)} bold />
        )}
        {wording && days !== null && (
          <p className="text-muted-foreground">
            {t(wording === 'adds' ? 'charge.addsDays' : 'charge.wouldAddDays', {
              count: days,
              n: formatNumber(days, locale),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
