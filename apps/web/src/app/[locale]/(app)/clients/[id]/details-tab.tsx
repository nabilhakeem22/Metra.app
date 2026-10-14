'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import type { Client, ClientType } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { CLIENT_FORM_FIELDS } from '@/lib/clients/fields';
import type { ClientFormState } from '../client-form-state';
import { useClientDetailsForm } from './use-client-details-form';

const TYPES: ClientType[] = ['individual', 'company', 'consultant'];

type DetailsField = (typeof CLIENT_FORM_FIELDS)[number];

/** The control a field's refusal sits under: the pair under the English name. */
export function detailsControlId(field: DetailsField): string {
  return `d-${field === 'name' ? 'nameEn' : field}`;
}

export function DetailsTab({ client, canManage }: { client: Client; canManage: boolean }) {
  const t = useTranslations('clients');
  const th = useTranslations('hints.client');
  const details = useClientDetailsForm(client);
  const { form, errors } = details;
  const fieldsRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldsRef, errors.invalidAttempt);
  // Not disabled while saving: a refusal moves the caret into its field, and a
  // disabled box cannot take it.
  const disabled = !canManage;
  // One name is enough: a missing name is said once, under the English name.
  const pair = errors.bind('name');

  const field = (
    key: keyof ClientFormState,
    label: string,
    options: { dir?: 'ltr' | 'rtl' | 'auto'; hint?: string; required?: boolean } = {},
  ) => {
    const own = errors.bind(key);
    const isPair = key === 'nameEn' || key === 'nameAr';
    const sharesPairError = key === 'nameAr' && Boolean(pair.error);
    return (
      <FormField
        id={detailsControlId(key)}
        label={label}
        hint={options.hint}
        required={options.required}
        error={(key === 'nameEn' ? pair.error : undefined) ?? own.error}
        onEdit={() => {
          own.onEdit();
          if (isPair) pair.onEdit();
        }}
      >
        <Input
          dir={options.dir ?? 'ltr'}
          aria-invalid={sharesPairError ? true : undefined}
          aria-describedby={sharesPairError ? fieldErrorId(detailsControlId('name')) : undefined}
          value={form[key]}
          onChange={(e) => details.set(key, e.target.value)}
          disabled={disabled}
        />
      </FormField>
    );
  };

  return (
    <Card>
      <CardContent ref={fieldsRef} className="space-y-4 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('nameEn', t('form.nameEn'), { hint: th('name'), required: true })}
          {field('nameAr', t('form.nameAr'), { dir: 'rtl', hint: th('name'), required: true })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="d-type" label={t('form.type')} hint={th('type')}>
            <SelectControl
              value={form.type}
              onValueChange={(value) => details.set('type', value as ClientType)}
              options={TYPES.map((type) => ({ value: type, label: t(`types.${type}`) }))}
              disabled={disabled}
            />
          </FormField>
          {field('contactName', t('form.contactName'), { dir: 'auto', hint: th('contactName') })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('email', t('form.email'), { hint: th('email') })}
          {field('phone', t('form.phone'), { hint: th('phone') })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('city', t('form.city'), { dir: 'auto', hint: th('city') })}
          {field('country', t('form.country'), { dir: 'auto' })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('address', t('form.address'), { dir: 'auto', hint: th('address') })}
          {/* Advance / retention are NOT edited here any more: they are derived from
              the client's committed contracts and shown on the Financials tab. */}
          {field('taxRegistrationNumber', t('form.taxCode'), { hint: th('taxRegistrationNumber') })}
        </div>
        {field('notes', t('form.notes'), { dir: 'auto' })}

        {errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {errors.formError}
          </p>
        )}
        {canManage && (
          <div className="flex justify-end">
            <Button variant="default" type="button" onClick={details.save} disabled={details.saving}>
              {details.saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('profile.details.save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
