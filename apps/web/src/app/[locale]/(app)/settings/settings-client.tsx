'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { updateOrgProfile } from '@/lib/org/actions';
import { ORG_PROFILE_FIELDS, orgProfileFieldErrors } from '@/lib/org/profile-field-rules';
import { SettingsProfileCard, type ProfileDraft } from './settings-profile-card';
import { SettingsVisibilityCard } from './settings-visibility-card';
import { useSaveVisibility } from './use-save-visibility';

interface Initial extends ProfileDraft {
  hideMarginFromPm: boolean;
  restrictFirmDashboard: boolean;
}

export function SettingsClient({
  canManage,
  initial,
  savedLogoId,
}: {
  canManage: boolean;
  initial: Initial;
  /** The saved logo's file id (also its cache key), or null when there is none. */
  savedLogoId: string | null;
}) {
  const t = useTranslations('settings');
  const th = useTranslations('hints.org');
  const te = useTranslations('errors');
  const [savingProfile, startProfile] = useTransition();
  const visibility = useSaveVisibility();
  const profileErrors = useFieldErrors({ fields: ORG_PROFILE_FIELDS, translate: te });

  const [profile, setProfile] = useState<ProfileDraft>({
    nameEn: initial.nameEn,
    nameAr: initial.nameAr,
    city: initial.city,
    taxRegistrationNumber: initial.taxRegistrationNumber,
  });
  const [hideMargin, setHideMargin] = useState(initial.hideMarginFromPm);
  const [restrictDash, setRestrictDash] = useState(initial.restrictFirmDashboard);

  function saveProfile() {
    if (profileErrors.applyLocal(orgProfileFieldErrors(profile))) return;
    startProfile(async () => {
      try {
        const result = await updateOrgProfile(profile);
        if (!profileErrors.applyResult(result)) toast({ title: t('saved') });
      } catch (rejection) {
        profileErrors.applyRejection(rejection);
      }
    });
  }

  const disabled = !canManage;

  return (
    <div className="space-y-6">
      {!canManage && (
        <p className="rounded-item border bg-muted/40 p-3 text-body text-muted-foreground">
          {t('readonly')}
        </p>
      )}

      <SettingsProfileCard
        t={t}
        th={th}
        savedLogoId={savedLogoId}
        disabled={disabled}
        draft={profile}
        setField={(field, value) => setProfile((current) => ({ ...current, [field]: value }))}
        bind={profileErrors.bind}
        formError={profileErrors.formError}
        invalidAttempt={profileErrors.invalidAttempt}
        canManage={canManage}
        saveProfile={saveProfile}
        savingProfile={savingProfile}
      />

      <SettingsVisibilityCard
        t={t}
        th={th}
        hideMargin={hideMargin}
        setHideMargin={setHideMargin}
        restrictDash={restrictDash}
        setRestrictDash={setRestrictDash}
        disabled={disabled}
        canManage={canManage}
        saveSettings={() => visibility.save({ hideMarginFromPm: hideMargin, restrictFirmDashboard: restrictDash })}
        savingSettings={visibility.saving}
      />
    </div>
  );
}
