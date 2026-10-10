'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { updateOrgProfile, updateOrgSettings } from '@/lib/org/actions';
import { SettingsProfileCard } from './settings-profile-card';
import { SettingsVisibilityCard } from './settings-visibility-card';

interface Initial {
  nameEn: string;
  nameAr: string;
  city: string;
  taxRegistrationNumber: string;
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
  const [savingSettings, startSettings] = useTransition();

  const [nameEn, setNameEn] = useState(initial.nameEn);
  const [nameAr, setNameAr] = useState(initial.nameAr);
  const [city, setCity] = useState(initial.city);
  const [tax, setTax] = useState(initial.taxRegistrationNumber);
  const [hideMargin, setHideMargin] = useState(initial.hideMarginFromPm);
  const [restrictDash, setRestrictDash] = useState(initial.restrictFirmDashboard);

  const errorMessage = (code?: ActionCode) => resolveActionError(code, te);

  function saveProfile() {
    startProfile(async () => {
      const res = await updateOrgProfile({
        nameEn,
        nameAr,
        city,
        taxRegistrationNumber: tax,
      });
      toast(
        res.ok
          ? { title: t('saved') }
          : { title: errorMessage(res.error), variant: 'destructive' },
      );
    });
  }

  function saveSettings() {
    startSettings(async () => {
      const res = await updateOrgSettings({
        hideMarginFromPm: hideMargin,
        restrictFirmDashboard: restrictDash,
      });
      toast(
        res.ok
          ? { title: t('saved') }
          : { title: errorMessage(res.error), variant: 'destructive' },
      );
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
        nameEn={nameEn}
        setNameEn={setNameEn}
        nameAr={nameAr}
        setNameAr={setNameAr}
        city={city}
        setCity={setCity}
        tax={tax}
        setTax={setTax}
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
        saveSettings={saveSettings}
        savingSettings={savingSettings}
      />
    </div>
  );
}
