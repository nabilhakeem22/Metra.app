'use client';

import type { useTranslations } from 'next-intl';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import { ProjectScheduleFields } from './project-form-schedule';
import type { ProjectFormState } from './project-form-state';
import type { ClientOption } from './types';

// The project field groups (code · names · client · status; the dates and the
// location are `project-form-schedule.tsx`). All
// form state and mutations live in the parent (ProjectForm); this child is
// presentational, driven by `form` and the curried `set` updater.
export function ProjectFormFields({
  t,
  th,
  locale,
  form,
  set,
  clientOptions,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  th: ReturnType<typeof useTranslations<'hints.project'>>;
  locale: string;
  form: ProjectFormState;
  set: (k: Exclude<keyof ProjectFormState, 'locationEdited'>) => (v: string) => void;
  clientOptions: ClientOption[];
}) {
  return (
    <>
      {/* The code is AUTO-GENERATED (P-YYYY-NNNN) when the project is created, so
          there is nothing to type. On a new project it is not shown at all; on an
          existing one it is shown read-only, because it is the reference people
          have already quoted in emails and on drawings. */}
      {form.code && (
        <div className="space-y-2">
          <Label htmlFor="pr-code">{t('form.code')}</Label>
          <Input id="pr-code" dir="ltr" value={form.code} readOnly disabled />
        </div>
      )}

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
        <Select value={form.clientId} onValueChange={(v) => set('clientId')(v)}>
          <SelectTrigger id="pr-client" aria-describedby="pr-client-hint" aria-required="true">
            <SelectValue placeholder={t('form.clientPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {pickLocale(
                  { nameAr: c.nameAr, nameEn: c.nameEn },
                  'name',
                  locale,
                ).value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Status is an EDIT field: a new project is created active. */}
      {form.code !== '' && (
      <div className="space-y-2">
        <Label htmlFor="pr-status" className="flex items-center">
          {t('form.status')}
          <FieldHint id="pr-status-hint" hint={th('status')} />
        </Label>
        <Select value={form.status} onValueChange={(v) => set('status')(v)}>
          <SelectTrigger id="pr-status" aria-describedby="pr-status-hint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}

      <ProjectScheduleFields t={t} form={form} set={set} />
    </>
  );
}
