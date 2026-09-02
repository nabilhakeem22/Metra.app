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
import type { ProjectFormState } from './project-form';
import type { ClientOption } from './types';

// The project field groups (code · names · client · status · dates · city). All
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
  set: (k: keyof ProjectFormState) => (v: string) => void;
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
          <SelectTrigger id="pr-client" aria-describedby="pr-client-hint">
            <SelectValue />
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
          <Label htmlFor="pr-end">
            {t('form.endDate')}
            <span className="ms-1 text-[color:var(--danger)]" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="pr-end"
            type="date"
            dir="ltr"
            required
            aria-required
            value={form.endDate}
            onChange={(e) => set('endDate')(e.target.value)}
          />
        </div>
      </div>
      {/* Spec: dates are for tracking, and the end date is not a commitment. */}
      <p className="-mt-2 text-xs text-muted-foreground">{t('form.endDateNote')}</p>

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
