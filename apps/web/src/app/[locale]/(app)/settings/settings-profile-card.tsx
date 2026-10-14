'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { OrgProfileField } from '@/lib/org/profile-field-rules';
import { SettingsLogoField } from './settings-logo-field';

/** The profile's four boxes, as the card holds them. */
export interface ProfileDraft {
  nameEn: string;
  nameAr: string;
  city: string;
  taxRegistrationNumber: string;
}

type ProfileBinding = (field: OrgProfileField) => { error: string | undefined; onEdit: () => void };

/** The control a profile field's refusal sits under: the pair under the English name. */
export function profileControlId(field: OrgProfileField): string {
  return `org-${field === 'name' ? 'nameEn' : field}`;
}

// The org profile card (logo · names · city · tax). The profile's state, save
// and refusals live in the parent (SettingsClient); the logo is its own field
// (SettingsLogoField), which uploads on pick and shows the saved logo.
export function SettingsProfileCard({
  t,
  th,
  savedLogoId,
  disabled,
  draft,
  setField,
  bind,
  formError,
  invalidAttempt,
  canManage,
  saveProfile,
  savingProfile,
}: {
  t: ReturnType<typeof useTranslations<'settings'>>;
  th: ReturnType<typeof useTranslations<'hints.org'>>;
  /** The saved logo's file id (also its cache key), or null when there is none. */
  savedLogoId: string | null;
  disabled: boolean;
  draft: ProfileDraft;
  setField: (field: keyof ProfileDraft, value: string) => void;
  /** The refusal under each field, and the edit that clears it. */
  bind: ProfileBinding;
  /** A refusal no field owns, said under Save. */
  formError: string | null;
  /** Moves on each refused save: the caret goes to the first refused field. */
  invalidAttempt: number;
  canManage: boolean;
  saveProfile: () => void;
  savingProfile: boolean;
}) {
  const fieldsRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldsRef, invalidAttempt);
  // One name is enough: a missing name is said once, under the English name,
  // and marks both; typing in either clears it.
  const pair = bind('name');

  const box = (field: keyof ProfileDraft, label: string, options: { dir?: 'ltr' | 'rtl'; hint?: string } = {}) => {
    const own = bind(field);
    const isPair = field === 'nameEn' || field === 'nameAr';
    const sharesPairError = field === 'nameAr' && Boolean(pair.error);
    return (
      <FormField
        id={profileControlId(field)}
        label={label}
        hint={options.hint}
        error={(field === 'nameEn' ? pair.error : undefined) ?? own.error}
        onEdit={() => {
          own.onEdit();
          if (isPair) pair.onEdit();
        }}
      >
        <Input
          dir={options.dir}
          aria-invalid={sharesPairError ? true : undefined}
          aria-describedby={sharesPairError ? fieldErrorId(profileControlId('name')) : undefined}
          value={draft[field]}
          onChange={(event) => setField(field, event.target.value)}
          disabled={disabled}
        />
      </FormField>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profileTitle')}</CardTitle>
        <CardDescription>{t('profileSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingsLogoField savedLogoId={savedLogoId} disabled={disabled} />

        <div ref={fieldsRef} className="grid gap-4 sm:grid-cols-2">
          {box('nameEn', t('nameEnLabel'), { dir: 'ltr', hint: th('name') })}
          {box('nameAr', t('nameArLabel'), { dir: 'rtl', hint: th('name') })}
          {box('city', t('cityLabel'))}
          {box('taxRegistrationNumber', t('taxLabel'), { dir: 'ltr' })}
        </div>

        {formError && (
          <p className="text-body text-destructive" role="alert">
            {formError}
          </p>
        )}
        {canManage && (
          <Button variant="default" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
