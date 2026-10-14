'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { Link } from '@/i18n/routing';
import { createProject, updateProject } from '@/lib/projects/actions';
import { projectFieldErrors } from '@/lib/projects/field-rules';
import { PROJECT_CREATE_FIELDS, type ProjectField } from '@/lib/projects/fields';
import { ProjectFormFields } from './project-form-fields';
import {
  emptyProjectForm,
  projectFormOf,
  projectPayload,
  todayIsoLocal,
  withClient,
  type ProjectFormState,
} from './project-form-state';
import type { ClientOption, ProjectListItem } from './types';

/** An edit also shows the (read-only) code. */
const PROJECT_EDIT_FIELDS: readonly ProjectField[] = [...PROJECT_CREATE_FIELDS, 'code'];

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

/**
 * Add or edit one project. Save checks the typed values first and says what is
 * wrong under each field; what only the server knows (a client archived
 * meanwhile, a code taken) comes back the same way. With no client to pick,
 * every refusal is said above the footer.
 */
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
  const [pending, startTransition] = useTransition();
  const noClients = clientOptions.length === 0;
  const errors = useFieldErrors<ProjectField>({
    fields: noClients ? [] : item ? PROJECT_EDIT_FIELDS : PROJECT_CREATE_FIELDS,
    translate: te,
  });
  const { clear } = errors;

  useEffect(() => {
    if (!open) return;
    clear();
    setForm(
      item
        ? projectFormOf(item)
        : emptyProjectForm(clientOptions, defaultClientId, todayIsoLocal(new Date()), defaultCountry),
    );
  }, [open, item, clientOptions, defaultClientId, defaultCountry, clear]);

  const set = (key: keyof ProjectFormState) => (value: string) =>
    setForm((prev) => {
      if (key === 'clientId') return withClient(prev, value, clientOptions, defaultCountry);
      const locationEdited = prev.locationEdited || key === 'city' || key === 'country';
      return { ...prev, [key]: value, locationEdited };
    });

  function submit() {
    const payload = projectPayload(form);
    // The start date is required on create only; an edit sends its stored code back.
    const rules = item ? { requireCode: true } : { requireStartDate: true };
    if (errors.applyLocal(projectFieldErrors(payload, rules))) return;
    startTransition(async () => {
      try {
        // A new project is created ACTIVE by the server; only an edit sends a status.
        const result = item
          ? await updateProject({ id: item.id, ...payload, status: form.status })
          : await createProject(payload);
        if (errors.applyResult(result)) return;
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

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
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
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
          bind={errors.bind}
        />
      )}
    </FormSheet>
  );
}
