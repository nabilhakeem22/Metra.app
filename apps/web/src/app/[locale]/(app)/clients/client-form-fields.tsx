'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { fieldErrorId } from '@/components/ui/field-error-text';
import type { CLIENT_FORM_FIELDS } from '@/lib/clients/fields';
import type { ClientFormState } from './client-form-state';

type FieldDir = 'ltr' | 'rtl' | 'auto';
type ClientFormField = (typeof CLIENT_FORM_FIELDS)[number];

/** What a FormField needs from the sheet's refusal state for one field. */
interface FieldBinding {
  error: string | undefined;
  onEdit: () => void;
}

/** The control a field's refusal sits under: the pair `name` under the English name. */
export function clientControlId(field: ClientFormField): string {
  return `cl-${field === 'name' ? 'nameEn' : field}`;
}

/**
 * The new/edit client fields. PRESENTATIONAL: the sheet owns the state.
 * Free text a studio may type in either language (contact name, city, address,
 * notes) is `dir="auto"`, never forced LTR. Tax number, address and notes sit
 * under "More details", open from the start when an edited client has any.
 */
export function ClientFormFields({
  form,
  set,
  isCreate,
  more,
  bind,
}: {
  form: ClientFormState;
  set: (key: keyof ClientFormState) => (value: string) => void;
  isCreate: boolean;
  /** The "More details" disclosure, owned by the sheet (it decides the initial state). */
  more: { open: boolean; toggle: () => void };
  /** The refusal under each field, and the edit that clears it. */
  bind: (field: ClientFormField) => FieldBinding;
}) {
  const t = useTranslations('clients');
  const th = useTranslations('hints.client');
  // One name is enough, so a missing name is said once, under the first, and
  // marks both; typing in either clears it.
  const pair = bind('name');

  const field = (
    key: keyof ClientFormState,
    label: string,
    options: { dir?: FieldDir; hint?: string; required?: boolean } = {},
  ) => {
    const own = bind(key);
    const isPair = key === 'nameEn' || key === 'nameAr';
    const sharesPairError = key === 'nameAr' && Boolean(pair.error);
    return (
      <FormField
        id={clientControlId(key)}
        label={label}
        required={options.required}
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
          aria-describedby={sharesPairError ? fieldErrorId(clientControlId('name')) : undefined}
          value={form[key]}
          onChange={(event) => set(key)(event.target.value)}
        />
      </FormField>
    );
  };

  return (
    <>
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('nameEn', t('form.nameEn'), { hint: th('name'), required: true })}
          {field('nameAr', t('form.nameAr'), { dir: 'rtl', hint: th('name'), required: true })}
        </div>
        <p className="text-caption text-muted-foreground">{t('form.nameRequired')}</p>
      </div>
      <div className="space-y-2">
        {field('contactName', t('form.contactName'), { dir: 'auto', hint: th('contactName') })}
        {isCreate && <p className="text-caption text-muted-foreground">{t('form.contactNote')}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('email', t('form.email'), { hint: th('email') })}
        {field('phone', t('form.phone'), { hint: th('phone'), required: true })}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('city', t('form.city'), { dir: 'auto', hint: th('city') })}
        {field('country', t('form.country'), { dir: 'auto' })}
      </div>

      <button
        type="button"
        aria-expanded={more.open}
        aria-controls="cl-more-details"
        onClick={more.toggle}
        className="text-small font-semibold text-brand-ink hover:underline"
      >
        {more.open ? '−' : '+'} {t('form.moreDetails')}
      </button>
      {more.open && (
        <div id="cl-more-details" className="space-y-4">
          {field('taxRegistrationNumber', t('form.taxCode'), { hint: th('taxRegistrationNumber') })}
          {field('address', t('form.address'), { dir: 'auto', hint: th('address') })}
          {field('notes', t('form.notes'), { dir: 'auto', hint: th('notes') })}
        </div>
      )}
    </>
  );
}
