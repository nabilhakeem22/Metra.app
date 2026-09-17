'use client';

import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ClientFilter, ClientStatusFilter } from './client-filters';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

/** The search box, the two filters, and the New button. */
export function ClientsToolbar({
  filter,
  onFilterChange,
  cities,
  canManage,
  onNew,
}: {
  filter: ClientFilter;
  onFilterChange: (filter: ClientFilter) => void;
  /** Every city present in the data — see cityOptions. */
  cities: string[];
  canManage: boolean;
  onNew: () => void;
}) {
  const t = useTranslations('clients');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={filter.query}
          onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
          placeholder={t('search')}
          className="ps-9"
        />
      </div>
      <select
        value={filter.status}
        onChange={(event) =>
          onFilterChange({ ...filter, status: event.target.value as ClientStatusFilter })
        }
        aria-label={t('table.status')}
        className={SELECT_CLASS}
      >
        <option value="all">{t('filter.allStatuses')}</option>
        <option value="active">{t('status.active')}</option>
        <option value="inactive">{t('status.inactive')}</option>
      </select>
      <select
        value={filter.city}
        onChange={(event) => onFilterChange({ ...filter, city: event.target.value })}
        aria-label={t('table.city')}
        className={SELECT_CLASS}
      >
        <option value="all">{t('filter.allCities')}</option>
        {cities.map((city) => (
          <option key={city} value={city}>
            {city}
          </option>
        ))}
      </select>
      {canManage && (
        <Button data-tour="clients-new" className="ms-auto" onClick={onNew}>
          <Plus className="size-4" aria-hidden />
          {t('actions.new')}
        </Button>
      )}
    </div>
  );
}
