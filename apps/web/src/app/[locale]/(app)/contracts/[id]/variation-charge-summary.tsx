'use client';

import { useLocale, useTranslations } from 'next-intl';
import { variationCharge } from '@/lib/execution/money/variation-charge';
import { formatMoneyExact } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { extensionDaysWording } from '@/lib/variations/time-extension';
import type { VariationChargeRates } from './contract-vo-types';

const CHARGE_PARTS = ['works', 'tax', 'supervision', 'total'] as const;

/**
 * What a change order of an execution contract charges the client: its works
 * (the net change), VAT and supervision on them at the contract's rates (D4a)
 * and the total, each to the exact piastre fraction so the parts add up to the
 * total as shown (F4). Then the days it adds, worded by its status (F2).
 */
export function VariationChargeSummary({
  netDelta,
  status,
  timeExtensionDays,
  rates,
}: {
  netDelta: string;
  status: string;
  timeExtensionDays: number | null;
  rates: VariationChargeRates;
}) {
  const t = useTranslations('variations.charge');
  const locale = useLocale();
  const charge = variationCharge(netDelta, rates.taxRate, rates.supervisionPct);
  const wording = extensionDaysWording(status, timeExtensionDays);

  return (
    <div className="mt-1 space-y-0.5 text-caption text-muted-foreground">
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
        {CHARGE_PARTS.map((part) => (
          <div key={part} className="flex gap-1">
            <dt>{t(part)}</dt>
            <dd dir="ltr" className="whitespace-nowrap font-mono tabular-nums">
              {formatMoneyExact(charge[part], locale)}
            </dd>
          </div>
        ))}
      </dl>
      {wording && timeExtensionDays !== null && (
        <p>
          {t(wording === 'adds' ? 'addsDays' : 'wouldAddDays', {
            count: timeExtensionDays,
            n: formatNumber(timeExtensionDays, locale),
          })}
        </p>
      )}
    </div>
  );
}
