'use client';

import type { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import type { ProjectFieldErrors } from './project-form-fields';
import type { ProjectFormState } from './project-form-state';

// When and where: the dates (start required on create, end optional) and the
// location (filled from the client until the studio edits it). Presentational.
export function ProjectScheduleFields({
  t,
  form,
  set,
  errors,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  form: ProjectFormState;
  set: (k: Exclude<keyof ProjectFormState, 'locationEdited'>) => (v: string) => void;
  errors: Pick<ProjectFieldErrors, 'startDate' | 'endDate'>;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="pr-start" label={t('form.startDate')} required error={errors.startDate}>
          <Input
            type="date"
            dir="ltr"
            required
            value={form.startDate}
            onChange={(e) => set('startDate')(e.target.value)}
          />
        </FormField>
        <FormField id="pr-end" label={t('form.endDate')} error={errors.endDate}>
          <Input
            type="date"
            dir="ltr"
            value={form.endDate}
            onChange={(e) => set('endDate')(e.target.value)}
          />
        </FormField>
      </div>
      {/* Spec: dates are for tracking, and the end date is not a commitment. */}
      <p className="-mt-2 text-caption text-muted-foreground">{t('form.endDateNote')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="pr-city" label={t('form.city')}>
          <Input value={form.city} onChange={(e) => set('city')(e.target.value)} />
        </FormField>
        <FormField id="pr-country" label={t('form.country')}>
          <Input value={form.country} onChange={(e) => set('country')(e.target.value)} />
        </FormField>
      </div>
    </>
  );
}
