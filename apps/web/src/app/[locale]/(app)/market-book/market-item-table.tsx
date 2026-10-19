'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import type { MarketItemRow as Row } from '@/lib/market-book/types';
import { MarketItemRow } from './market-item-row';

export interface MarketItemTableProps {
  items: Row[];
  /** Sub-category names by key, when a search lists several categories; null for one category. */
  categoryNames: Readonly<Record<string, string>> | null;
  canAdd: boolean;
  onOpen: (item: Row) => void;
  onAdd: (item: Row) => void;
}

export function MarketItemTable({ items, categoryNames, canAdd, onOpen, onAdd }: MarketItemTableProps) {
  const t = useTranslations('marketBook');
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b text-caption text-muted-foreground">
                <th className="px-4 py-2 text-start font-medium">{t('table.item')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('table.latest')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('table.mom')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('table.ytd')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('table.trend')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('table.priceBook')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <MarketItemRow
                  key={item.id}
                  item={item}
                  categoryName={categoryNames?.[item.categoryKey] ?? null}
                  canAdd={canAdd}
                  onOpen={onOpen}
                  onAdd={onAdd}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
