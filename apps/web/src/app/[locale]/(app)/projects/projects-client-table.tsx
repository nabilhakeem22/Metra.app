'use client';

import { Pencil, Power } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ProjectListItem } from './types';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-[color:var(--success-tint)] text-[color:var(--success)]',
  on_hold: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  completed: 'bg-[color:var(--brand-tint)] text-[color:var(--brand-ink)]',
  cancelled: 'bg-destructive/10 text-destructive',
};

// The projects list table. All list/filter/mutation state lives in the parent
// (ProjectsClient); this child renders `filtered` rows and forwards row actions
// through the passed setters/handlers.
export function ProjectsClientTable({
  t,
  locale,
  filtered,
  canManage,
  pending,
  dateRange,
  setEditing,
  setFormOpen,
  toggleActive,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  locale: string;
  filtered: ProjectListItem[];
  canManage: boolean;
  pending: boolean;
  dateRange: (p: ProjectListItem) => string;
  setEditing: Dispatch<SetStateAction<ProjectListItem | null>>;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  toggleActive: (item: ProjectListItem) => void;
}) {
  return (
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
                      <Link href={`/projects/${p.id}`} className="hover:underline">
                        {name}
                      </Link>
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
  );
}
