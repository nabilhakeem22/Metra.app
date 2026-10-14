'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { DocumentCategoryAddForm } from './document-category-add-form';
import { useCategoryRetirement } from './use-category-retirement';

export interface DocumentCategoryRow {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  active: boolean;
}

/**
 * Settings — the firm's document filing vocabulary. Each org starts from a default
 * set and can rename, add to, or retire it.
 *
 * RETIRE, NOT DELETE, and the copy says so: a retired category disappears from the
 * upload picker but every document already filed under it stays exactly where it is.
 * There is no delete control because there is no delete path — files reference these
 * rows, and a misclick must not be able to pull a category out from under them.
 */
export function DocumentCategoriesCard({
  categories,
}: {
  categories: DocumentCategoryRow[];
}) {
  const t = useTranslations('settings.documentCategories');
  const tc = useTranslations('common');
  const locale = useLocale();
  const retirement = useCategoryRetirement(categories);

  return (
    <Card>
      {retirement.dialog}
      <CardContent className="space-y-4 py-5">
        <div>
          <h2 className="text-body font-semibold">{t('title')}</h2>
          <p className="mt-1 text-caption text-muted-foreground">{t('subtitle')}</p>
        </div>

        <ul className="divide-y rounded-panel border">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span
                className={`flex-1 text-body ${c.active ? '' : 'text-muted-foreground line-through'}`}
              >
                {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value}
              </span>
              {!c.active && (
                <span className="text-caption text-muted-foreground">{t('retired')}</span>
              )}
              <OverflowMenu
                label={tc('moreActions')}
                disabled={retirement.pending}
                actions={[
                  {
                    key: 'active',
                    label: t(c.active ? 'retire' : 'restore'),
                    destructive: c.active,
                    onSelect: () => void retirement.toggle(c),
                  },
                ]}
              />
            </li>
          ))}
        </ul>

        <DocumentCategoryAddForm />
        <p className="text-caption text-muted-foreground">{t('retireNote')}</p>
      </CardContent>
    </Card>
  );
}
