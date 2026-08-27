'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type ChangeEvent } from 'react';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  createLogoUpload,
  setOrgLogo,
  updateOrgProfile,
  updateOrgSettings,
} from '@/lib/org/actions';
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
}: {
  canManage: boolean;
  initial: Initial;
}) {
  const t = useTranslations('settings');
  const th = useTranslations('hints.org');
  const te = useTranslations('errors');
  const [savingProfile, startProfile] = useTransition();
  const [savingSettings, startSettings] = useTransition();
  const [uploading, startUpload] = useTransition();

  const [nameEn, setNameEn] = useState(initial.nameEn);
  const [nameAr, setNameAr] = useState(initial.nameAr);
  const [city, setCity] = useState(initial.city);
  const [tax, setTax] = useState(initial.taxRegistrationNumber);
  const [hideMargin, setHideMargin] = useState(initial.hideMarginFromPm);
  const [restrictDash, setRestrictDash] = useState(initial.restrictFirmDashboard);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

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

  function onLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
    startUpload(async () => {
      try {
        const signed = await createLogoUpload({
          contentType: file.type,
          originalName: file.name,
        });
        // Manage-gated server-side; the inner catch surfaces the generic toast.
        if ('ok' in signed) throw new Error('logo_forbidden');
        const put = await fetch(signed.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type, 'x-upsert': 'true' },
          body: file,
        });
        if (put.ok) {
          await setOrgLogo(signed.fileId);
          toast({ title: t('logoUpdated') });
        } else {
          toast({ title: t('errorGeneric'), variant: 'destructive' });
        }
      } catch {
        toast({ title: t('errorGeneric'), variant: 'destructive' });
      }
    });
  }

  const disabled = !canManage;

  return (
    <div className="space-y-6">
      {!canManage && (
        <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t('readonly')}
        </p>
      )}

      <SettingsProfileCard
        t={t}
        th={th}
        logoPreview={logoPreview}
        onLogo={onLogo}
        disabled={disabled}
        uploading={uploading}
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
