'use client';

import { Percent, Plus, Search, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { SectionOption } from './types';

export function PriceBookToolbar({
  q,
  onQChange,
  sectionFilter,
  onSectionFilterChange,
  activeOnly,
  onActiveOnlyChange,
  sections,
  canManage,
  newSection,
  onNewSectionChange,
  onAddSection,
  pending,
  onBulkUpdate,
  onImport,
  onNew,
}: {
  q: string;
  onQChange: (value: string) => void;
  sectionFilter: string;
  onSectionFilterChange: (value: string) => void;
  activeOnly: boolean;
  onActiveOnlyChange: (value: boolean) => void;
  sections: SectionOption[];
  canManage: boolean;
  newSection: string;
  onNewSectionChange: (value: string) => void;
  onAddSection: () => void;
  pending: boolean;
  onBulkUpdate: () => void;
  onImport: () => void;
  onNew: () => void;
}) {
  const t = useTranslations('priceBook');
  const locale = useLocale();
  const sectionName = (s: SectionOption) =>
    pickLocale({ nameAr: s.nameAr, nameEn: s.nameEn }, 'name', locale).value;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          placeholder={t('search')}
          className="ps-9"
        />
      </div>

      <Select value={sectionFilter} onValueChange={onSectionFilterChange}>
        <SelectTrigger className="w-auto min-w-40" aria-label={t('table.section')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('allCategories')}</SelectItem>
          {sections.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {sectionName(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(e) => onActiveOnlyChange(e.target.checked)}
        />
        {t('activeOnly')}
      </label>

      {canManage && (
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Input
              value={newSection}
              onChange={(e) => onNewSectionChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAddSection();
              }}
              placeholder={t('addSectionPlaceholder')}
              className="h-10 w-40"
              aria-label={t('addSection')}
            />
            <Button
              variant="outline"
              onClick={onAddSection}
              disabled={pending || newSection.trim() === ''}
            >
              <Plus className="size-4" aria-hidden />
              {t('addSection')}
            </Button>
          </div>
          <Button variant="outline" onClick={onBulkUpdate}>
            <Percent className="size-4" aria-hidden />
            {t('actions.bulkUpdate')}
          </Button>
          <Button variant="outline" onClick={onImport}>
            <Upload className="size-4" aria-hidden />
            {t('actions.import')}
          </Button>
          <Button data-tour="price-book-new" onClick={onNew}>
            <Plus className="size-4" aria-hidden />
            {t('actions.new')}
          </Button>
        </div>
      )}
    </div>
  );
}
