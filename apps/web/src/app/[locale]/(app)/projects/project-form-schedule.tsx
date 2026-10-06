'use client';

import type { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProjectFormState } from './project-form-state';

// When and where: the dates (start required on create, end optional) and the
// location (filled from the client until the studio edits it). Presentational.
export function ProjectScheduleFields({
  t,
  form,
  set,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  form: ProjectFormState;
  set: (k: Exclude<keyof ProjectFormState, 'locationEdited'>) => (v: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pr-start">
            {t('form.startDate')}
            <span className="ms-1 text-[color:var(--danger)]" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="pr-start"
            type="date"
            dir="ltr"
            required
            aria-required
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
      {/* Spec: dates are for tracking, and the end date is not a commitment. */}
      <p className="-mt-2 text-caption text-muted-foreground">{t('form.endDateNote')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pr-city">{t('form.city')}</Label>
          <Input
            id="pr-city"
            value={form.city}
            onChange={(e) => set('city')(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pr-country">{t('form.country')}</Label>
          <Input
            id="pr-country"
            value={form.country}
            onChange={(e) => set('country')(e.target.value)}
          />
        </div>
      </div>
    </>
  );
}
