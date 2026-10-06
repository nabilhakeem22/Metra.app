'use client';

import type { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import { ProjectScheduleFields } from './project-form-schedule';
import type { ProjectFormState } from './project-form-state';
import type { ClientOption } from './types';

/** A refusal resolved to text, under the field it is about. */
export interface ProjectFieldErrors {
  name?: string;
  code?: string;
  client?: string;
  startDate?: string;
  endDate?: string;
}

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
  errors,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  th: ReturnType<typeof useTranslations<'hints.project'>>;
  locale: string;
  form: ProjectFormState;
  set: (k: Exclude<keyof ProjectFormState, 'locationEdited'>) => (v: string) => void;
  clientOptions: ClientOption[];
  errors: ProjectFieldErrors;
}) {
  return (
    <>
      {/* The code is AUTO-GENERATED (P-YYYY-NNNN) when the project is created, so
          there is nothing to type. On a new project it is not shown at all; on an
          existing one it is shown read-only, because it is the reference people
          have already quoted in emails and on drawings. */}
      {form.code && (
        <FormField id="pr-code" label={t('form.code')} error={errors.code}>
          <Input dir="ltr" value={form.code} readOnly disabled />
        </FormField>
      )}

      {/* One name is enough, so a missing name is said once, under the first,
          and marks both. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="pr-nameEn" label={t('form.nameEn')} hint={th('name')} error={errors.name}>
          <Input dir="ltr" value={form.nameEn} onChange={(e) => set('nameEn')(e.target.value)} />
        </FormField>
        <FormField id="pr-nameAr" label={t('form.nameAr')} hint={th('name')}>
          <Input
            dir="rtl"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'pr-nameEn-error' : undefined}
            value={form.nameAr}
            onChange={(e) => set('nameAr')(e.target.value)}
          />
        </FormField>
      </div>

      <FormField
        id="pr-client"
        label={t('form.client')}
        required
        hint={th('client')}
        error={errors.client}
      >
        <SelectControl
          value={form.clientId}
          onValueChange={(v) => set('clientId')(v)}
          placeholder={t('form.clientPlaceholder')}
          options={clientOptions.map((c) => ({
            value: c.id,
            label: pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value,
          }))}
        />
      </FormField>

      {/* Status is an EDIT field: a new project is created active. */}
      {form.code !== '' && (
        <FormField id="pr-status" label={t('form.status')} hint={th('status')}>
          <SelectControl
            value={form.status}
            onValueChange={(v) => set('status')(v)}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))}
          />
        </FormField>
      )}

      <ProjectScheduleFields t={t} form={form} set={set} errors={errors} />
    </>
  );
}
