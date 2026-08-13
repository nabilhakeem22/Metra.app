'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import type { ProjectStatus } from '@metra/db';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { createProject, updateProject } from '@/lib/projects/actions';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import type { ClientOption, ProjectListItem } from './types';

export interface ProjectFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ProjectListItem | null;
  clientOptions: ClientOption[];
  /** Preselected client for a NEW project (e.g. opened from a client profile). */
  defaultClientId?: string;
}

interface FormState {
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
): FormState {
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
  const [form, setForm] = useState<FormState>(emptyState(clientOptions));
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

  const set = (k: keyof FormState) => (v: string) =>
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

  const selectClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
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
            <div className="space-y-2">
              <Label htmlFor="pr-code" className="flex items-center">
                {t('form.code')}
                <FieldHint id="pr-code-hint" hint={th('code')} />
              </Label>
              <Input
                id="pr-code"
                dir="ltr"
                aria-describedby="pr-code-hint"
                value={form.code}
                onChange={(e) => set('code')(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pr-nameEn" className="flex items-center">
                  {t('form.nameEn')}
                  <FieldHint id="pr-name-hint" hint={th('name')} />
                </Label>
                <Input
                  id="pr-nameEn"
                  dir="ltr"
                  aria-describedby="pr-name-hint"
                  value={form.nameEn}
                  onChange={(e) => set('nameEn')(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr-nameAr" className="flex items-center">
                  {t('form.nameAr')}
                  <FieldHint id="pr-namear-hint" hint={th('name')} />
                </Label>
                <Input
                  id="pr-nameAr"
                  dir="rtl"
                  aria-describedby="pr-namear-hint"
                  value={form.nameAr}
                  onChange={(e) => set('nameAr')(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pr-client" className="flex items-center">
                {t('form.client')}
                <FieldHint id="pr-client-hint" hint={th('client')} />
              </Label>
              <select
                id="pr-client"
                className={selectClass}
                aria-describedby="pr-client-hint"
                value={form.clientId}
                onChange={(e) => set('clientId')(e.target.value)}
              >
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pickLocale(
                      { nameAr: c.nameAr, nameEn: c.nameEn },
                      'name',
                      locale,
                    ).value}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pr-status" className="flex items-center">
                {t('form.status')}
                <FieldHint id="pr-status-hint" hint={th('status')} />
              </Label>
              <select
                id="pr-status"
                className={selectClass}
                aria-describedby="pr-status-hint"
                value={form.status}
                onChange={(e) => set('status')(e.target.value)}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`statuses.${s}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pr-start">{t('form.startDate')}</Label>
                <Input
                  id="pr-start"
                  type="date"
                  dir="ltr"
                  value={form.startDate}
                  onChange={(e) => set('startDate')(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr-end">{t('form.endDate')}</Label>
                <Input
                  id="pr-end"
                  type="date"
                  dir="ltr"
                  value={form.endDate}
                  onChange={(e) => set('endDate')(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pr-city">{t('form.city')}</Label>
              <Input
                id="pr-city"
                value={form.city}
                onChange={(e) => set('city')(e.target.value)}
              />
            </div>

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
