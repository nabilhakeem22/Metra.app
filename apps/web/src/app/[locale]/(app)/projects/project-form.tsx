'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { toast } from '@/hooks/use-toast';
import { Link } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createProject, updateProject } from '@/lib/projects/actions';
import { projectFieldFor, type ProjectFormField } from './project-form-errors';
import { ProjectFormFields } from './project-form-fields';
import {
  canSaveProject,
  emptyProjectForm,
  projectFormOf,
  todayIsoLocal,
  withClient,
  type ProjectFormState,
} from './project-form-state';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ProjectListItem | null;
  clientOptions: ClientOption[];
  /** Preselected client for a NEW project (e.g. opened from a client profile). */
  defaultClientId?: string;
  /** May this role add a client (the no-clients state links to it)? */
  canAddClient?: boolean;
}

export function ProjectForm({
  open,
  onOpenChange,
  item,
  clientOptions,
  defaultClientId,
  canAddClient = false,
}: ProjectFormProps) {
  const t = useTranslations('projects');
  const th = useTranslations('hints.project');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const defaultCountry = t('form.countryDefault');
  const [form, setForm] = useState<ProjectFormState>(() =>
    emptyProjectForm(clientOptions, undefined, '', defaultCountry),
  );
  const [error, setError] = useState<{ code: ActionCode; field: ProjectFormField } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      item
        ? projectFormOf(item)
        : emptyProjectForm(clientOptions, defaultClientId, todayIsoLocal(new Date()), defaultCountry),
    );
  }, [open, item, clientOptions, defaultClientId, defaultCountry]);

  const set = (key: keyof ProjectFormState) => (value: string) =>
    setForm((prev) => {
      if (key === 'clientId') return withClient(prev, value, clientOptions, defaultCountry);
      const locationEdited = prev.locationEdited || key === 'city' || key === 'country';
      return { ...prev, [key]: value, locationEdited };
    });
  const messageFor = (field: ProjectFormField) =>
    error?.field === field ? resolveActionError(error.code, te) : undefined;

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        ...(form.code ? { code: form.code } : {}),
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        clientId: form.clientId,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        city: form.city || null,
        country: form.country || null,
        address: form.address || null,
        notes: form.notes || null,
      };
      try {
        // A new project is created ACTIVE by the server; only an edit sends a status.
        const res = item
          ? await updateProject({ id: item.id, ...payload, status: form.status })
          : await createProject(payload);
        if (res.ok) {
          toast({ title: t(item ? 'toast.updated' : 'toast.created') });
          onOpenChange(false);
          return;
        }
        const code = (res.error as ActionCode) ?? 'generic';
        setError({ code, field: projectFieldFor(code) });
      } catch {
        setError({ code: 'generic', field: 'form' });
      }
    });
  }

  const noClients = clientOptions.length === 0;
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(item ? 'form.editTitle' : 'form.newTitle')}
      onSubmit={submit}
      submitLabel={t('form.save')}
      cancelLabel={t('form.cancel')}
      closeLabel={tc('close')}
      pending={pending}
      canSubmit={!noClients && canSaveProject(form, !item)}
      formError={messageFor('form')}
    >
      {noClients ? (
        <div className="space-y-2 rounded-item border bg-muted/40 p-3 text-body text-muted-foreground">
          <p>{t('form.noClients')}</p>
          {canAddClient && (
            <Button asChild size="sm" variant="secondary">
              <Link href="/clients?new=1">{t('empty.addClient')}</Link>
            </Button>
          )}
        </div>
      ) : (
        <ProjectFormFields
          t={t}
          th={th}
          locale={locale}
          form={form}
          set={set}
          clientOptions={clientOptions}
          errors={{
            name: messageFor('name'),
            code: messageFor('code'),
            client: messageFor('client'),
            startDate: messageFor('startDate'),
            endDate: messageFor('endDate'),
          }}
        />
      )}
    </FormSheet>
  );
}
