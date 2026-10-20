'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/i18n/routing';
import { formatMonth } from '@/lib/format/date';
import { formatMoneyExact } from '@/lib/format/money';
import { studioUnitFor } from '@/lib/market-book/units';
import { MarketChangeChip } from './market-change-chip';
import { itemName, itemSpec, itemUnit } from './market-item-text';
import type { MarketRowView as Row } from './market-row-view';
import { MarketSparkline } from './market-sparkline';

export interface MarketItemRowProps {
  item: Row;
  /** The item's sub-category, said under its name when a search mixes categories. */
  categoryName: string | null;
  canAdd: boolean;
  onOpen: (item: Row) => void;
  onAdd: (item: Row) => void;
}

function LatestPrice({ item }: { item: Row }) {
  const t = useTranslations('marketBook');
  const locale = useLocale();
  const latest = item.latest;
  if (!latest) return <span className="text-muted-foreground" aria-hidden>·</span>;
  return (
    <div className="space-y-0.5">
      {latest.price !== null ? (
        <div dir="ltr" className="whitespace-nowrap font-mono tabular-nums text-[color:var(--text)]">
          {formatMoneyExact(latest.price, locale)}
        </div>
      ) : (
        <span className="rounded-pill bg-[color:var(--warn-tint)] px-2 py-0.5 text-caption text-[color:var(--warn)]">{t('suspended')}</span>
      )}
      <div className="text-caption text-muted-foreground">{formatMonth(latest.month, locale)}</div>
    </div>
  );
}

function PriceBookAction({ item, canAdd, onAdd }: Pick<MarketItemRowProps, 'item' | 'canAdd' | 'onAdd'>) {
  const t = useTranslations('marketBook');
  if (item.linkedCostItem) {
    return (
      <Link href={`/price-book?q=${encodeURIComponent(item.linkedCostItem.code)}`} className="whitespace-nowrap text-caption font-medium text-brand hover:underline">
        {t('inPriceBook')}
      </Link>
    );
  }
  if (!canAdd || item.status !== 'active') return null;
  // What the seed skips cannot be added either: no studio unit, or never priced.
  const refusal = studioUnitFor(item.unit) === null ? t('unitNotSupported') : item.latestPriced === null ? t('neverPriced') : null;
  const add = (
    <Button type="button" variant="secondary" size="sm" disabled={refusal !== null} onClick={() => onAdd(item)}>
      <Plus className="size-4" aria-hidden />
      {t('add')}
    </Button>
  );
  if (refusal === null) return add;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button fires no pointer events, so the wrapper carries the tooltip. */}
          <span tabIndex={0} className="inline-flex">{add}</span>
        </TooltipTrigger>
        <TooltipContent>{refusal}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** One market item: name, latest official price, its changes, the trend, and the studio's own link to it. */
export function MarketItemRow({ item, categoryName, canAdd, onOpen, onAdd }: MarketItemRowProps) {
  const t = useTranslations('marketBook');
  const locale = useLocale();
  const spec = itemSpec(item, locale);
  const unit = itemUnit(item, locale, (marketUnit) => t(`units.${marketUnit}`));
  return (
    <tr className="border-b align-top last:border-0 hover:bg-muted/40">
      <td className="px-4 py-2.5">
        <button type="button" onClick={() => onOpen(item)} className="text-start font-medium text-[color:var(--text)] hover:underline focus-ring-brand outline-none">
          {itemName(item, locale)}
        </button>
        <div className="text-caption text-muted-foreground">
          {[spec, t('perUnit', { unit }), categoryName].filter(Boolean).join(' · ')}
        </div>
        {item.status === 'discontinued' && <div className="text-caption text-muted-foreground">{t('discontinued')}</div>}
      </td>
      <td className="px-4 py-2.5 text-end">
        <LatestPrice item={item} />
      </td>
      <td className="px-4 py-2.5">
        <MarketChangeChip pct={item.momPct} label={t('table.mom')} />
      </td>
      <td className="px-4 py-2.5">
        <MarketChangeChip pct={item.ytdPct} label={t('table.ytd')} />
      </td>
      <td className="px-4 py-2.5">
        <MarketSparkline trend={item.trend} label={t('trend')} />
      </td>
      <td className="px-4 py-2.5 text-end">
        <PriceBookAction item={item} canAdd={canAdd} onAdd={onAdd} />
      </td>
    </tr>
  );
}
