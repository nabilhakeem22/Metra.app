'use client';

import { useLocale, useTranslations } from 'next-intl';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { StatusChip } from '@/components/ui/status-chip';
import type { CostEntryRow as CostEntry } from '@/lib/execution/costs/types';
import { formatDate } from '@/lib/format/date';
import { formatNumber } from '@/lib/format/number';
import { cn } from '@/lib/utils';
import { targetLabel } from './cost-entry-labels';

const ONE_DECIMAL: Intl.NumberFormatOptions = Object.freeze({ minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });

/**
 * One cost on the Costs tab: when, what, where it is booked, how much, and
 * the market price of its price book item for reference (only when the units
 * compare). Edit and void only on an entry this member may change (owner and
 * admin any, another role its own); a voided entry stays, struck through, with
 * no actions.
 */
export function CostEntryRow({
  entry,
  m,
  pending,
  onEdit,
  onVoid,
}: {
  entry: CostEntry;
  m: (value: string) => string;
  pending: boolean;
  onEdit: (entry: CostEntry) => void;
  onVoid: (entry: CostEntry) => void;
}) {
  const t = useTranslations('contracts.costs');
  const tp = useTranslations('priceBook');
  const tc = useTranslations('common');
  const locale = useLocale();
  const details = [entry.supplier, entry.reference].filter(Boolean).join(' · ');

  return (
    <tr className={cn('border-b align-top last:border-0', entry.voided && 'text-muted-foreground')}>
      <td className="px-4 py-2 text-caption tabular-nums" dir="ltr">
        {formatDate(entry.incurredOn, locale)}
      </td>
      <td className="px-4 py-2">
        <div className={cn(entry.voided && 'line-through')}>{entry.description}</div>
        <div className="text-caption text-muted-foreground">
          {t(`categories.${entry.category}`)}
          {details && ` · ${details}`}
        </div>
        {entry.voided && <StatusChip tone="neutral" label={t('voided')} />}
      </td>
      <td className="px-4 py-2 text-caption">{targetLabel(entry, locale, t('wholeContract'))}</td>
      <td className="px-4 py-2 text-end">
        <div className={cn('font-mono tabular-nums', entry.voided && 'line-through')} dir="ltr">
          {m(entry.amount)}
        </div>
        {entry.qty !== null && entry.unit !== null && entry.unitCost !== null && (
          <div className="text-caption text-muted-foreground">
            {t('quantity', { qty: formatNumber(entry.qty, locale), unit: tp(`units.${entry.unit}`), unitCost: m(entry.unitCost) })}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-end text-caption">
        {entry.market && (
          <>
            <div className="text-muted-foreground">{t('market', { price: m(entry.market.unitCost) })}</div>
            <span aria-hidden className="rounded-pill bg-[color:var(--track)] px-2 py-0.5 font-mono tabular-nums" dir="ltr">
              {`${formatNumber(entry.market.variancePct, locale, ONE_DECIMAL)}%`}
            </span>
            <span className="sr-only">{t('marketVariance', { value: `${formatNumber(entry.market.variancePct, locale, ONE_DECIMAL)}%` })}</span>
          </>
        )}
      </td>
      <td className="px-4 py-2">
        {entry.editable && !entry.voided && (
          <OverflowMenu
            label={tc('moreActions')}
            disabled={pending}
            actions={[
              { key: 'edit', label: t('edit'), onSelect: () => onEdit(entry) },
              { key: 'void', label: t('void'), destructive: true, onSelect: () => onVoid(entry) },
            ]}
          />
        )}
      </td>
    </tr>
  );
}
