'use client';

import { FolderKanban, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { formatDate } from '@/lib/format/date';
import { setProjectActive } from '@/lib/projects/actions';
import { ProjectForm } from './project-form';
import { ProjectsClientTable } from './projects-client-table';
import { ProjectsClientToolbar } from './projects-client-toolbar';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectsClientProps {
  items: ProjectListItem[];
  clientOptions: ClientOption[];
  canManage: boolean;
  /** When arriving from a client profile's "new project" CTA. */
  initialNewClientId?: string;
}

export function ProjectsClient({
  items,
  clientOptions,
  canManage,
  initialNewClientId,
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

  // Arrived from a client profile's "new project for this client" CTA: open the
  // new-project form once, with that client preselected.
  useEffect(() => {
    if (canManage && initialNewClientId) {
      setEditing(null);
      setFormOpen(true);
    }
  }, [canManage, initialNewClientId]);

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
      defaultClientId={initialNewClientId}
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

      <ProjectsClientToolbar
        t={t}
        q={q}
        setQ={setQ}
        status={status}
        setStatus={setStatus}
        activeOnly={activeOnly}
        setActiveOnly={setActiveOnly}
        canManage={canManage}
        clientOptions={clientOptions}
        openNew={openNew}
      />

      <ProjectsClientTable
        t={t}
        locale={locale}
        filtered={filtered}
        canManage={canManage}
        pending={pending}
        dateRange={dateRange}
        setEditing={setEditing}
        setFormOpen={setFormOpen}
        toggleActive={toggleActive}
      />
    </div>
  );
}
