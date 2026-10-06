'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

export interface ClientFormState {
  nameEn: string;
  nameAr: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  taxRegistrationNumber: string;
  notes: string;
}

type FieldDir = 'ltr' | 'rtl' | 'auto';

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
  errors,
}: {
  form: ClientFormState;
  set: (key: keyof ClientFormState) => (value: string) => void;
  isCreate: boolean;
  /** The "More details" disclosure, owned by the sheet (it decides the initial state). */
  more: { open: boolean; toggle: () => void };
  /** A refusal resolved to text, under the field it is about. */
  errors: { name?: string; phone?: string };
}) {
  const t = useTranslations('clients');
  const th = useTranslations('hints.client');

  const field = (
    key: keyof ClientFormState,
    label: string,
    options: {
      dir?: FieldDir;
      hint?: string;
      required?: boolean;
      error?: string;
      /** The id of an error said under ANOTHER field that is about this one too. */
      sharedErrorId?: string;
    } = {},
  ) => (
    <FormField
      id={`cl-${key}`}
      label={label}
      required={options.required}
      hint={options.hint}
      error={options.error}
    >
      <Input
        dir={options.dir ?? 'ltr'}
        aria-invalid={options.sharedErrorId ? true : undefined}
        aria-describedby={options.sharedErrorId}
        value={form[key]}
        onChange={(event) => set(key)(event.target.value)}
      />
    </FormField>
  );

  return (
    <>
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* One name is enough, so a missing name is said once, under the first,
              and marks both. */}
          {field('nameEn', t('form.nameEn'), { hint: th('name'), required: true, error: errors.name })}
          {field('nameAr', t('form.nameAr'), {
            dir: 'rtl',
            hint: th('name'),
            required: true,
            sharedErrorId: errors.name ? 'cl-nameEn-error' : undefined,
          })}
        </div>
        <p className="text-caption text-muted-foreground">{t('form.nameRequired')}</p>
      </div>
      <div className="space-y-2">
        {field('contactName', t('form.contactName'), { dir: 'auto', hint: th('contactName') })}
        {isCreate && <p className="text-caption text-muted-foreground">{t('form.contactNote')}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('email', t('form.email'), { hint: th('email') })}
        {field('phone', t('form.phone'), { hint: th('phone'), required: true, error: errors.phone })}
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
