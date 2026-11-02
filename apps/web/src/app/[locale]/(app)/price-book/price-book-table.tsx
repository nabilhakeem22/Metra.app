'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { PriceBookMarketColumn } from '@/lib/market-book/types';
import type { PriceBookGroup } from './price-book-groups';
import { PriceBookRow } from './price-book-row';
import type { PriceBookItem, SectionOption } from './types';

export function PriceBookTable({
  groups,
  market,
  canManage,
  showsCost,
  pending,
  onEdit,
  onToggleActive,
}: {
  groups: PriceBookGroup[];
  /** The Market column: shown only once a bulletin is published (market plan AC 18). */
  market: PriceBookMarketColumn;
  canManage: boolean;
  /** The Cost column, only for a reader who may see margin. */
  showsCost: boolean;
  pending: boolean;
  onEdit: (item: PriceBookItem) => void;
  onToggleActive: (item: PriceBookItem) => void;
}) {
  const t = useTranslations('priceBook');
  const locale = useLocale();
  const sectionName = (s: SectionOption) =>
    pickLocale({ nameAr: s.nameAr, nameEn: s.nameEn }, 'name', locale).value;

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState title={t('noMatch')} />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <Card key={group.section.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-body font-semibold">
                {sectionName(group.section)}
              </h2>
              <span className="text-caption text-muted-foreground">
                {t('itemsCount', { count: formatNumber(group.matched, locale) })}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b text-caption text-muted-foreground">
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.code')}
                    </th>
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.name')}
                    </th>
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.unit')}
                    </th>
                    {showsCost && <th className="px-4 py-2 text-end font-medium">{t('table.cost')}</th>}
                    <th className="px-4 py-2 text-end font-medium">
                      {t('table.price')}
                    </th>
                    {market.bulletin !== null && <th className="px-4 py-2 text-end font-medium">{t('market.column')}</th>}
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.status')}
                    </th>
                    {canManage && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((item) => (
                    <PriceBookRow
                      key={item.id}
                      item={item}
                      showsMarket={market.bulletin !== null}
                      marketRef={market.refs[item.id]}
                      canManage={canManage}
                      showsCost={showsCost}
                      pending={pending}
                      onEdit={onEdit}
                      onToggleActive={onToggleActive}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
