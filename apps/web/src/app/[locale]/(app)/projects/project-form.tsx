'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { Link } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createProject, updateProject } from '@/lib/projects/actions';
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
  const locale = useLocale();
  const defaultCountry = t('form.countryDefault');
  const [form, setForm] = useState<ProjectFormState>(() =>
    emptyProjectForm(clientOptions, undefined, '', defaultCountry),
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
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

  function submit() {
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
      // A new project is created ACTIVE by the server; only an edit sends a status.
      const res = item
        ? await updateProject({ id: item.id, ...payload, status: form.status })
        : await createProject(payload);
      if (res.ok) {
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } else {
        toast({ title: resolveActionError(res.error as ActionCode, te), variant: 'destructive' });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t(item ? 'form.editTitle' : 'form.newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t(item ? 'form.editTitle' : 'form.newTitle')}
        </SheetDescription>

        {clientOptions.length === 0 ? (
          <div className="mt-4 space-y-2 rounded-item border bg-muted/40 p-3 text-body text-muted-foreground">
            <p>{t('form.noClients')}</p>
            {canAddClient && (
              <Button asChild size="sm" variant="outline">
                <Link href="/clients?new=1">{t('empty.addClient')}</Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <ProjectFormFields
              t={t}
              th={th}
              locale={locale}
              form={form}
              set={set}
              clientOptions={clientOptions}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                {t('form.cancel')}
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={pending || !canSaveProject(form, !item)}
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('form.save')}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
