'use client';

import { FolderKanban, Pencil, Plus, Power, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { setProjectActive } from '@/lib/projects/actions';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import { ProjectForm } from './project-form';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectsClientProps {
  items: ProjectListItem[];
  clientOptions: ClientOption[];
  canManage: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-500/10 text-emerald-600',
  on_hold: 'bg-amber-500/10 text-amber-600',
  completed: 'bg-blue-500/10 text-blue-600',
  cancelled: 'bg-destructive/10 text-destructive',
};

export function ProjectsClient({
  items,
  clientOptions,
  canManage,
}: ProjectsClientProps) {
  const t = useTranslations('projects');
  const te = useTranslations('errors');
  const locale = useLocale();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectListItem | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (activeOnly && !p.active) return false;
      if (needle) {
        const hay = `${p.code} ${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, status, activeOnly]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function toggleActive(item: ProjectListItem) {
    startTransition(async () => {
      const res = await setProjectActive(item.id, !item.active);
      toast(
        res.ok
          ? { title: t(item.active ? 'toast.deactivated' : 'toast.activated') }
          : {
              title: resolveActionError(res.error as ActionCode, te),
              variant: 'destructive',
            },
      );
    });
  }

  const dateRange = (p: ProjectListItem): string => {
    const s = p.startDate ? formatDate(p.startDate, locale) : '';
    const e = p.endDate ? formatDate(p.endDate, locale) : '';
    if (s && e) return `${s} – ${e}`;
    return s || e || '—';
  };

  const form = canManage && (
    <ProjectForm
      open={formOpen}
      onOpenChange={setFormOpen}
      item={editing}
      clientOptions={clientOptions}
    />
  );

  if (items.length === 0) {
    return (
      <>
        {form}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={<FolderKanban className="size-6" aria-hidden />}
              title={t('empty.title')}
              description={t('empty.description')}
              hint={clientOptions.length === 0 ? t('empty.needClient') : undefined}
              action={
                canManage && clientOptions.length > 0 ? (
                  <Button data-tour="projects-new" onClick={openNew}>
                    <Plus className="size-4" aria-hidden />
                    {t('actions.new')}
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {form}

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
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label={t('table.status')}
        >
          <option value="all">{t('allStatuses')}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t('table.code')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.name')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.client')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.status')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.dates')}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const name = pickLocale(
                    { nameAr: p.nameAr, nameEn: p.nameEn },
                    'name',
                    locale,
                  ).value;
                  const clientName = pickLocale(
                    { nameAr: p.clientNameAr, nameEn: p.clientNameEn },
                    'name',
                    locale,
                  ).value;
                  return (
                    <tr
                      key={p.id}
                      className={`border-b last:border-0 hover:bg-muted/40 ${p.active ? '' : 'opacity-60'}`}
                    >
                      <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                        {p.code}
                      </td>
                      <td className="px-4 py-2">
                        {name}
                        {!p.active && (
                          <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {t('archived')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {clientName || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[p.status] ?? 'bg-muted text-muted-foreground'}`}
                        >
                          {t(`statuses.${p.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                        {dateRange(p)}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditing(p);
                                setFormOpen(true);
                              }}
                              aria-label={t('actions.edit')}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleActive(p)}
                              disabled={pending}
                              aria-label={t(
                                p.active ? 'actions.deactivate' : 'actions.activate',
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
    </div>
  );
}
