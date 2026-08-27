'use client';

import { Plus, Search } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import type { ClientOption } from './types';

// The projects list filter bar (search · status · active-only · new). All filter
// state lives in the parent (ProjectsClient); this child renders the controls and
// forwards changes through the passed setters/handler.
export function ProjectsClientToolbar({
  t,
  q,
  setQ,
  status,
  setStatus,
  activeOnly,
  setActiveOnly,
  canManage,
  clientOptions,
  openNew,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  q: string;
  setQ: Dispatch<SetStateAction<string>>;
  status: string;
  setStatus: Dispatch<SetStateAction<string>>;
  activeOnly: boolean;
  setActiveOnly: Dispatch<SetStateAction<boolean>>;
  canManage: boolean;
  clientOptions: ClientOption[];
  openNew: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          className="ps-9"
        />
      </div>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-auto min-w-40" aria-label={t('table.status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('allStatuses')}</SelectItem>
          {PROJECT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`statuses.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(e) => setActiveOnly(e.target.checked)}
        />
        {t('activeOnly')}
      </label>
      {canManage && clientOptions.length > 0 && (
        <Button data-tour="projects-new" className="ms-auto" onClick={openNew}>
          <Plus className="size-4" aria-hidden />
          {t('actions.new')}
        </Button>
      )}
    </div>
  );
}
