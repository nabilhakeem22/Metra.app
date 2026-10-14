'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { Textarea } from '@/components/ui/textarea';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import type { DetailsOption } from './details-tab';
import { DetailsTypeField } from './details-type-field';
import type { useAddProjectType } from './use-add-project-type';
import type { PROJECT_DETAILS_FIELDS, ProjectDetailsDraft, useProjectDetailsForm } from './use-project-details-form';

type DetailsField = (typeof PROJECT_DETAILS_FIELDS)[number];

/** The control a field's refusal sits under: the pair under the English name. */
export function projectDetailsControlId(field: DetailsField): string {
  const ids: Partial<Record<DetailsField, string>> = { name: 'p-nameEn', clientId: 'p-client', typeId: 'p-type' };
  return ids[field] ?? `p-${field}`;
}

type TextKey = 'code' | 'nameEn' | 'nameAr' | 'city' | 'country' | 'address' | 'notes';

// The project details field groups (code · client · names · type · status ·
// description · location · notes + save). The state, the refusals and Save
// live in useProjectDetailsForm; this child is presentational.
export function DetailsFields({
  t,
  details,
  addType,
  canManage,
  clientOptions,
  projectTypes,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  details: ReturnType<typeof useProjectDetailsForm>;
  addType: ReturnType<typeof useAddProjectType>;
  canManage: boolean;
  clientOptions: DetailsOption[];
  projectTypes: DetailsOption[];
}) {
  const tp = useTranslations('projects.profile.details');
  const th = useTranslations('hints.project');
  const locale = useLocale();
  const { form, errors } = details;
  const label = (o: DetailsOption) => pickLocale({ nameAr: o.nameAr, nameEn: o.nameEn }, 'name', locale).value;
  // Not disabled while saving: a refusal moves the caret into its field.
  const disabled = !canManage;
  const pair = errors.bind('name');
  const set = <K extends keyof ProjectDetailsDraft>(key: K) => (value: ProjectDetailsDraft[K]) => details.set(key, value);

  const field = (key: TextKey, text: string, options: { dir?: 'ltr' | 'rtl'; hint?: string } = {}) => {
    const own = errors.bind(key);
    const isPair = key === 'nameEn' || key === 'nameAr';
    const sharesPairError = key === 'nameAr' && Boolean(pair.error);
    return (
      <FormField
        id={projectDetailsControlId(key)}
        label={text}
        hint={options.hint}
        error={(key === 'nameEn' ? pair.error : undefined) ?? own.error}
        onEdit={() => {
          own.onEdit();
          if (isPair) pair.onEdit();
        }}
      >
        <Input
          dir={options.dir ?? 'ltr'}
          aria-invalid={sharesPairError ? true : undefined}
          aria-describedby={sharesPairError ? fieldErrorId(projectDetailsControlId('name')) : undefined}
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
          disabled={disabled}
        />
      </FormField>
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('code', t('form.code'), { hint: th('code') })}
        <FormField id={projectDetailsControlId('clientId')} label={t('form.client')} hint={th('client')} {...errors.bind('clientId')}>
          <SelectControl
            value={form.clientId}
            onValueChange={set('clientId')}
            options={clientOptions.map((c) => ({ value: c.id, label: label(c) }))}
            disabled={disabled}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('nameEn', t('form.nameEn'), { hint: th('name') })}
        {field('nameAr', t('form.nameAr'), { dir: 'rtl', hint: th('name') })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailsTypeField
          typeId={form.typeId}
          onTypeIdChange={set('typeId')}
          typeRefusal={errors.bind('typeId')}
          projectTypes={projectTypes}
          label={label}
          canManage={canManage}
          addType={addType}
        />
        <FormField id="p-status" label={t('form.status')} hint={th('status')}>
          <SelectControl
            value={form.status}
            onValueChange={(value) => set('status')(value as ProjectDetailsDraft['status'])}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))}
            disabled={disabled}
          />
        </FormField>
      </div>

      <FormField id={projectDetailsControlId('description')} label={tp('description')} hint={th('description')} {...errors.bind('description')}>
        <Textarea
          rows={3}
          dir="auto"
          value={form.description}
          onChange={(e) => set('description')(e.target.value)}
          disabled={disabled}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('city', t('form.city'))}
        {field('country', t('form.country'))}
        {field('address', t('form.address'))}
      </div>
      {field('notes', t('form.notes'))}

      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}
      {canManage && (
        <div className="flex justify-end">
          <Button variant="default" type="button" onClick={details.save} disabled={details.saving}>
            {details.saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {tp('save')}
          </Button>
        </div>
      )}
    </>
  );
}
