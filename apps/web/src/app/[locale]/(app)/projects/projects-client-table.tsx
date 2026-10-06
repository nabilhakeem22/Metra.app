'use client';

import { Pencil, Power } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { PROJECT_STATUS_TONE } from '@/lib/ui/record-status-tones';
import type { ProjectListItem } from './types';

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
          <table className="w-full text-body">
            <thead>
              <tr className="border-b text-caption text-muted-foreground">
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
                    <td className="px-4 py-2 font-mono text-caption" dir="ltr">
                      {p.code}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/projects/${p.id}`} className="hover:underline">
                        {name}
                      </Link>
                      {!p.active && (
                        <span className="ms-2 rounded-pill bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                          {t('archived')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {clientName || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusChip
                        tone={PROJECT_STATUS_TONE[p.status]}
                        label={t(`statuses.${p.status}`)}
                      />
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
