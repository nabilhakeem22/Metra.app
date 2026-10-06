'use client';

import { useTranslations } from 'next-intl';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
}: {
  form: ClientFormState;
  set: (key: keyof ClientFormState) => (value: string) => void;
  isCreate: boolean;
  /** The "More details" disclosure, owned by the sheet (it decides the initial state). */
  more: { open: boolean; toggle: () => void };
}) {
  const t = useTranslations('clients');
  const th = useTranslations('hints.client');

  const field = (
    key: keyof ClientFormState,
    label: string,
    options: { dir?: FieldDir; hint?: string; required?: boolean } = {},
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`cl-${key}`} className="flex items-center">
        {label}
        {options.required && (
          <span className="ms-1 text-[color:var(--danger)]" aria-hidden>
            *
          </span>
        )}
        {options.hint && <FieldHint id={`cl-${key}-hint`} hint={options.hint} />}
      </Label>
      <Input
        id={`cl-${key}`}
        dir={options.dir ?? 'ltr'}
        aria-required={options.required || undefined}
        aria-describedby={options.hint ? `cl-${key}-hint` : undefined}
        value={form[key]}
        onChange={(event) => set(key)(event.target.value)}
      />
    </div>
  );

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
