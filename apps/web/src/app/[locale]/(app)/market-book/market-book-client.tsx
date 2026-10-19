'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber } from '@/lib/format/number';
import type { MarketCategory, MarketItemRow } from '@/lib/market-book/types';
import { MarketAddForm, type MarketSectionOption } from './market-add-form';
import { MarketItemDrawer } from './market-item-drawer';
import { MarketItemTable } from './market-item-table';

export interface MarketBookClientProps {
  items: MarketItemRow[];
  matched: number;
  /** The leaf listed, or null for a search. */
  categoryKey: string | null;
  query: string;
  categories: MarketCategory[];
  /** Owners and admins (price_book create); empty for everyone else. */
  sections: MarketSectionOption[];
  canAdd: boolean;
  attribution: ReactNode;
}

/** One category's items or one search's, the item drawer, and the add form (the page's open state). */
export function MarketBookClient({ items, matched, categoryKey, query, categories, sections, canAdd, attribution }: MarketBookClientProps) {
  const t = useTranslations('marketBook');
  const locale = useLocale();
  const [opened, setOpened] = useState<MarketItemRow | null>(null);
  const [adding, setAdding] = useState<MarketItemRow | null>(null);
  const nameOf = (category: MarketCategory) => (locale.startsWith('ar') ? category.nameAr : category.nameEn);
  const leaf = categories.find((category) => category.key === categoryKey);
  const categoryNames = categoryKey === null ? Object.fromEntries(categories.map((category) => [category.key, nameOf(category)])) : null;

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-title font-semibold">
          {leaf ? nameOf(leaf) : t('results.search', { query, matched: formatNumber(matched, locale) })}
        </h2>
        {items.length < matched && (
          <p className="text-caption text-muted-foreground">{t('results.truncated', { shown: formatNumber(items.length, locale) })}</p>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title={t('results.none')} />
          </CardContent>
        </Card>
      ) : (
        <MarketItemTable items={items} categoryNames={categoryNames} canAdd={canAdd} onOpen={setOpened} onAdd={setAdding} />
      )}

      <MarketItemDrawer item={opened} onClose={() => setOpened(null)} attribution={attribution} />
      {canAdd && <MarketAddForm item={adding} sections={sections} onClose={() => setAdding(null)} />}
    </div>
  );
}
