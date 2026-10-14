'use client';

import { Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LOGO_ACCEPT } from '@/lib/org/logo-rules';
import { FIELD_MAX_LENGTH, type ONBOARDING_FIELDS, type OnboardingField } from './profile-field-limits';

type FieldBinding = (field: (typeof ONBOARDING_FIELDS)[number]) => { error: string | undefined; onEdit: () => void };

export interface OnboardingProfileValues {
  nameEn: string;
  nameAr: string;
  city: string;
}

/**
 * The fields of the one-screen onboarding: the studio's two names (one of them
 * required), its city and its logo, all optional beyond a name. Presentational:
 * the values, the logo file and every setter live in OnboardingWizard. The tax
 * number is not asked here; it stays in Settings, where nothing blocks on it.
 * Each text field stops at the server's cap and says so under itself; a refused
 * save says why under the field (the missing name under the Arabic name, the
 * first, marking both).
 */
export function OnboardingProfileFields({
  values,
  onChange,
  atLimit,
  bind,
  logo,
  logoPreview,
  pickLogo,
  removeLogo,
}: {
  values: OnboardingProfileValues;
  onChange: (field: keyof OnboardingProfileValues, value: string) => void;
  /** Fields at their length cap, each told so under itself. */
  atLimit: readonly OnboardingField[];
  /** The refusal under each field, and the edit that clears it. */
  bind: FieldBinding;
  logo: File | null;
  logoPreview: string | null;
  pickLogo: (event: ChangeEvent<HTMLInputElement>) => void;
  removeLogo: () => void;
}) {
  const t = useTranslations('onboarding');
  const th = useTranslations('hints.onboarding');
  const pair = bind('name');
  /** A refused save outranks the at-the-cap notice. */
  const messageFor = (field: OnboardingField) =>
    bind(field).error ?? (atLimit.includes(field) ? t('tooLong', { max: FIELD_MAX_LENGTH[field] }) : null);
  const editOf = (field: OnboardingField) => () => {
    bind(field).onEdit();
    if (field !== 'city') pair.onEdit();
  };

  return (
    <div className="space-y-4">
      <FormField
        id="nameAr"
        label={t('nameArLabel')}
        hint={th('orgName')}
        error={pair.error ?? messageFor('nameAr')}
        onEdit={editOf('nameAr')}
      >
        <Input
          dir="rtl"
          maxLength={FIELD_MAX_LENGTH.nameAr}
          value={values.nameAr}
          onChange={(event) => onChange('nameAr', event.target.value)}
        />
      </FormField>
      <FormField id="nameEn" label={t('nameEnLabel')} hint={th('orgName')} error={messageFor('nameEn')} onEdit={editOf('nameEn')}>
        <Input
          dir="ltr"
          maxLength={FIELD_MAX_LENGTH.nameEn}
          aria-invalid={pair.error ? true : undefined}
          aria-describedby={pair.error ? fieldErrorId('nameAr') : undefined}
          value={values.nameEn}
          onChange={(event) => onChange('nameEn', event.target.value)}
        />
      </FormField>
      <FormField id="city" label={t('cityLabel')} error={messageFor('city')} onEdit={editOf('city')}>
        <Input
          maxLength={FIELD_MAX_LENGTH.city}
          value={values.city}
          onChange={(event) => onChange('city', event.target.value)}
        />
      </FormField>

      <div className="space-y-2">
        <Label>{t('logoLabel')}</Label>
        <div className="flex items-center gap-3">
          {logoPreview ? (
            <img src={logoPreview} alt="" className="size-12 rounded-item border object-cover" />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-item bg-muted text-muted-foreground">
              <Upload className="size-5" aria-hidden />
            </div>
          )}
          <input id="logo" type="file" accept={LOGO_ACCEPT} className="hidden" onChange={pickLogo} />
          <Label
            htmlFor="logo"
            className="inline-flex h-9 cursor-pointer items-center rounded-pill border border-input px-3 text-body font-medium hover:bg-muted coarse:min-h-11"
          >
            {t('logoChoose')}
          </Label>
          {logo && (
            <Button type="button" variant="ghost" size="sm" onClick={removeLogo}>
              <X className="size-4" aria-hidden />
              {t('logoRemove')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
