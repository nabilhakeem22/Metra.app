'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { MilestoneBasis } from '@metra/db';
import type { FeeSplitSummary } from '@/lib/engagements/fee-split-total';
import { formatMoney } from '@/lib/format/money';

/** "100.0000" -> "100": the percent total as a person reads it (Latin digits). */
function plainPercent(scale4: string): string {
  return scale4.replace(/\.?0+$/, '');
}

/** The fee form's live total, and what the split still lacks. PRESENTATIONAL. */
export function FeeSplitTotal({ basis, summary }: { basis: MilestoneBasis; summary: FeeSplitSummary }) {
  const t = useTranslations('engagements.feeForm');
  const locale = useLocale();
  return (
    <div className="space-y-1 text-body" aria-live="polite">
      {summary.target !== null && (
        <p className={`tabular-nums ${summary.balanced ? '' : 'text-[color:var(--warn)]'}`}>
          {basis === 'percent'
            ? t('totalPercent', { total: plainPercent(summary.total) })
            : t('totalAmount', {
                total: formatMoney(summary.total, locale),
                target: formatMoney(summary.target, locale),
              })}
        </p>
      )}
      {!summary.hasFee && <p className="text-caption text-muted-foreground">{t('needsFee')}</p>}
      {!summary.hasDeposit && <p className="text-caption text-muted-foreground">{t('needsDeposit')}</p>}
    </div>
  );
}
