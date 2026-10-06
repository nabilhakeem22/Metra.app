'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { deactivationCopy, useActiveToggle } from '@/hooks/use-active-toggle';
import { useOpenOnArrival } from '@/hooks/use-open-on-arrival';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import { formatDate } from '@/lib/format/date';
import { setProjectActive } from '@/lib/projects/actions';
import { ProjectForm } from './project-form';
import { ProjectsClientTable } from './projects-client-table';
import { ProjectsClientToolbar } from './projects-client-toolbar';
import { ProjectsEmptyState } from './projects-empty-state';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectsClientProps {
  items: ProjectListItem[];
  clientOptions: ClientOption[];
  canManage: boolean;
  /** May this role add a client (the no-clients states link to it)? */
  canAddClient: boolean;
  /** When arriving from a client profile's "new project" CTA. */
  initialNewClientId?: string;
  /** Reached through `/projects?new=1`: open the new-project form once. */
  openCreateOnArrival: boolean;
}

export function ProjectsClient({
  items,
  clientOptions,
  canManage,
  canAddClient,
  initialNewClientId,
  openCreateOnArrival,
}: ProjectsClientProps) {
  const t = useTranslations('projects');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectListItem | null>(null);

  // Arrived from a client profile's "new project for this client" CTA (that
  // client preselected) or from `?new=1`: open the new-project form once.
  useOpenOnArrival(canManage && (Boolean(initialNewClientId) || openCreateOnArrival), openNew);

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

  const activeToggle = useActiveToggle({
    setActive: setProjectActive,
    copy: deactivationCopy(t, tc),
    onError: (result) =>
      toast({ title: resolveActionError(result.error, te), variant: 'destructive' }),
  });

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
      canAddClient={canAddClient}
    />
  );
  const dialogs = (
    <>
      {form}
      {activeToggle.dialog}
    </>
  );

  if (items.length === 0) {
    return (
      <>
        {dialogs}
        <ProjectsEmptyState
          hasClients={clientOptions.length > 0}
          canManage={canManage}
          canAddClient={canAddClient}
          onNew={openNew}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {dialogs}

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
        moreActionsLabel={tc('moreActions')}
        locale={locale}
        filtered={filtered}
        canManage={canManage}
        pending={activeToggle.pending}
        dateRange={dateRange}
        setEditing={setEditing}
        setFormOpen={setFormOpen}
        toggleActive={(project) => void activeToggle.toggle(project)}
      />
    </div>
  );
}
