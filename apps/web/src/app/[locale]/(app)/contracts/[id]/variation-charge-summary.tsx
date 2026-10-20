'use client';

import { useLocale, useTranslations } from 'next-intl';
import { variationCharge } from '@/lib/execution/money/variation-charge';
import { formatNumber } from '@/lib/format/number';
import type { VariationChargeRates } from './contract-vo-types';

const CHARGE_PARTS = ['works', 'tax', 'supervision', 'total'] as const;

/**
 * What a change order of an execution contract charges the client: its works
 * (the net change), VAT and supervision on them at the contract's rates (D4a),
 * the total, and the days it adds to the finish date when it adds any.
 */
export function VariationChargeSummary({
  netDelta,
  timeExtensionDays,
  rates,
  m,
}: {
  netDelta: string;
  timeExtensionDays: number | null;
  rates: VariationChargeRates;
  m: (value: string) => string;
}) {
  const t = useTranslations('variations.charge');
  const locale = useLocale();
  const charge = variationCharge(netDelta, rates.taxRate, rates.supervisionPct);

  return (
    <div className="mt-1 space-y-0.5 text-caption text-muted-foreground">
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
        {CHARGE_PARTS.map((part) => (
          <div key={part} className="flex gap-1">
            <dt>{t(part)}</dt>
            <dd dir="ltr" className="font-mono tabular-nums">
              {m(charge[part])}
            </dd>
          </div>
        ))}
      </dl>
      {timeExtensionDays !== null && timeExtensionDays > 0 && (
        <p>{t('addsDays', { count: timeExtensionDays, n: formatNumber(timeExtensionDays, locale) })}</p>
      )}
    </div>
  );
}
