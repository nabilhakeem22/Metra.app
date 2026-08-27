'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import type { ProjectStatus } from '@metra/db';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createProject, updateProject } from '@/lib/projects/actions';
import { ProjectFormFields } from './project-form-fields';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ProjectListItem | null;
  clientOptions: ClientOption[];
  /** Preselected client for a NEW project (e.g. opened from a client profile). */
  defaultClientId?: string;
}

export interface ProjectFormState {
  code: string;
  nameEn: string;
  nameAr: string;
  clientId: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  city: string;
  address: string;
  notes: string;
}

function emptyState(
  clientOptions: ClientOption[],
  defaultClientId?: string,
): ProjectFormState {
  const preselected =
    defaultClientId && clientOptions.some((c) => c.id === defaultClientId)
      ? defaultClientId
      : (clientOptions[0]?.id ?? '');
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    clientId: preselected,
    status: 'draft',
    startDate: '',
    endDate: '',
    city: '',
    address: '',
    notes: '',
  };
}

export function ProjectForm({
  open,
  onOpenChange,
  item,
  clientOptions,
  defaultClientId,
}: ProjectFormProps) {
  const t = useTranslations('projects');
  const th = useTranslations('hints.project');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [form, setForm] = useState<ProjectFormState>(emptyState(clientOptions));
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setForm(
      item
        ? {
            code: item.code,
            nameEn: item.nameEn ?? '',
            nameAr: item.nameAr ?? '',
            clientId: item.clientId,
            status: item.status,
            startDate: item.startDate ?? '',
            endDate: item.endDate ?? '',
            city: item.city ?? '',
            address: item.address ?? '',
            notes: item.notes ?? '',
          }
        : emptyState(clientOptions, defaultClientId),
    );
  }, [open, item, clientOptions, defaultClientId]);

  const set = (k: keyof ProjectFormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    startTransition(async () => {
      const payload = {
        code: form.code,
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        clientId: form.clientId,
        status: form.status,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        city: form.city || null,
        address: form.address || null,
        notes: form.notes || null,
      };
      const res = item
        ? await updateProject({ id: item.id, ...payload })
        : await createProject(payload);
      if (res.ok) {
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  const noClients = clientOptions.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t(item ? 'form.editTitle' : 'form.newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t(item ? 'form.editTitle' : 'form.newTitle')}
        </SheetDescription>

        {noClients ? (
          <p className="mt-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            {t('form.noClients')}
          </p>
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
              <Button type="button" onClick={submit} disabled={pending}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {t('form.save')}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
