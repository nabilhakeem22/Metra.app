'use client';

import type { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { projectControlId, type ProjectFieldBinding } from './project-form-controls';
import type { ProjectFormState } from './project-form-state';

// When and where: the dates (start required on create, end optional) and the
// location (filled from the client until the studio edits it). Presentational.
export function ProjectScheduleFields({
  t,
  form,
  set,
  bind,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  form: ProjectFormState;
  set: (k: Exclude<keyof ProjectFormState, 'locationEdited'>) => (v: string) => void;
  bind: ProjectFieldBinding;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={projectControlId('startDate')} label={t('form.startDate')} required {...bind('startDate')}>
          <Input
            type="date"
            dir="ltr"
            required
            value={form.startDate}
            onChange={(e) => set('startDate')(e.target.value)}
          />
        </FormField>
        <FormField id={projectControlId('endDate')} label={t('form.endDate')} {...bind('endDate')}>
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
        <FormField id={projectControlId('city')} label={t('form.city')} {...bind('city')}>
          <Input value={form.city} onChange={(e) => set('city')(e.target.value)} />
        </FormField>
        <FormField id={projectControlId('country')} label={t('form.country')} {...bind('country')}>
          <Input value={form.country} onChange={(e) => set('country')(e.target.value)} />
        </FormField>
      </div>
    </>
  );
}
