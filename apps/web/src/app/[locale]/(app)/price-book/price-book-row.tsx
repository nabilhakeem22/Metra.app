'use client';

import { Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { MarketPriceRef } from '@/lib/market-book/types';
import { MarketPriceCell } from './market-price-cell';
import type { PriceBookItem } from './types';

/**
 * One price book item: code, name, unit, cost (`showsCost`), price, status, the Market cell
 * while a bulletin is published (`showsMarket`), and the edit and
 * (de)activate actions for a role that may change the book.
 */
export function PriceBookRow({
  item,
  showsMarket,
  marketRef,
  canManage,
  showsCost,
  pending,
  onEdit,
  onToggleActive,
}: {
  item: PriceBookItem;
  showsMarket: boolean;
  /** The item's market reference; undefined when it is not linked (or the item is no longer published). */
  marketRef: MarketPriceRef | undefined;
  canManage: boolean;
  showsCost: boolean;
  pending: boolean;
  onEdit: (item: PriceBookItem) => void;
  onToggleActive: (item: PriceBookItem) => void;
}) {
  const t = useTranslations('priceBook');
  const tc = useTranslations('common');
  const locale = useLocale();
  const name = pickLocale({ nameAr: item.nameAr, nameEn: item.nameEn }, 'name', locale).value;

  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="px-4 py-2 font-mono text-caption" dir="ltr">
        {item.code}
      </td>
      <td className="px-4 py-2">{name}</td>
      <td className="px-4 py-2 text-muted-foreground">{t(`units.${item.unit}`)}</td>
      {showsCost && (
        <td className="px-4 py-2 text-end" dir="ltr">
          {formatMoney(item.defaultUnitCost, locale)}
        </td>
      )}
      <td className="px-4 py-2 text-end" dir="ltr">
        {formatMoney(item.defaultUnitPrice, locale)}
      </td>
      {showsMarket && (
        <td className="px-4 py-2 text-end">
          <MarketPriceCell linked={item.marketItemId !== null} reference={marketRef} />
        </td>
      )}
      <td className="px-4 py-2">
        <span
          className={
            item.active
              ? 'rounded-pill bg-[color:var(--success-tint)] px-2 py-0.5 text-caption text-[color:var(--success)]'
              : 'rounded-pill bg-muted px-2 py-0.5 text-caption text-muted-foreground'
          }
        >
          {t(item.active ? 'status.active' : 'status.inactive')}
        </span>
      </td>
      {canManage && (
        <td className="px-4 py-2">
          <div className="flex items-center justify-end gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(item)} aria-label={t('actions.edit')}>
              <Pencil className="size-4" aria-hidden />
            </Button>
            <OverflowMenu
              label={tc('moreActions')}
              disabled={pending}
              actions={[
                {
                  key: 'active',
                  label: t(item.active ? 'actions.deactivate' : 'actions.activate'),
                  destructive: item.active,
                  onSelect: () => onToggleActive(item),
                },
              ]}
            />
          </div>
        </td>
      )}
    </tr>
  );
}
