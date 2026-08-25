'use client';

import { Pencil, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { PriceBookItem, SectionOption } from './types';

export interface PriceBookGroup {
  section: SectionOption;
  rows: PriceBookItem[];
}

export function PriceBookTable({
  groups,
  canManage,
  pending,
  onEdit,
  onToggleActive,
}: {
  groups: PriceBookGroup[];
  canManage: boolean;
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
          <EmptyState title={t('empty.title')} />
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
              <h2 className="text-sm font-semibold">
                {sectionName(group.section)}
              </h2>
              <span className="text-xs text-muted-foreground">
                {t('itemsCount', { count: group.rows.length })}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.code')}
                    </th>
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.name')}
                    </th>
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.unit')}
                    </th>
                    <th className="px-4 py-2 text-end font-medium">
                      {t('table.cost')}
                    </th>
                    <th className="px-4 py-2 text-end font-medium">
                      {t('table.price')}
                    </th>
                    <th className="px-4 py-2 text-start font-medium">
                      {t('table.status')}
                    </th>
                    {canManage && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((item) => {
                    const name = pickLocale(
                      { nameAr: item.nameAr, nameEn: item.nameEn },
                      'name',
                      locale,
                    ).value;
                    return (
                      <tr
                        key={item.id}
                        className="border-b last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                          {item.code}
                        </td>
                        <td className="px-4 py-2">{name}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {t(`units.${item.unit}`)}
                        </td>
                        <td className="px-4 py-2 text-end" dir="ltr">
                          {formatMoney(item.defaultUnitCost, locale)}
                        </td>
                        <td className="px-4 py-2 text-end" dir="ltr">
                          {formatMoney(item.defaultUnitPrice, locale)}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              item.active
                                ? 'rounded-full bg-[color:var(--success-tint)] px-2 py-0.5 text-xs text-[color:var(--success)]'
                                : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                            }
                          >
                            {t(item.active ? 'status.active' : 'status.inactive')}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit(item)}
                                aria-label={t('actions.edit')}
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => onToggleActive(item)}
                                disabled={pending}
                                aria-label={t(
                                  item.active
                                    ? 'actions.deactivate'
                                    : 'actions.activate',
                                )}
                              >
                                <Power className="size-4" aria-hidden />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
