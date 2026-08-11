'use client';

import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  createLogoUpload,
  setOrgLogo,
  updateOrgProfile,
  updateOrgSettings,
} from '@/lib/org/actions';

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

      <Card>
        <CardHeader>
          <CardTitle>{t('profileTitle')}</CardTitle>
          <CardDescription>{t('profileSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt=""
                className="size-12 rounded-xl border object-cover"
              />
            ) : (
              <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Upload className="size-5" aria-hidden />
              </div>
            )}
            <input
              id="logo"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onLogo}
              disabled={disabled || uploading}
            />
            <Label
              htmlFor="logo"
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={disabled || uploading}
            >
              {uploading && <Loader2 className="me-2 size-4 animate-spin" aria-hidden />}
              {t('changeLogo')}
            </Label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nameEn">{t('nameEnLabel')}</Label>
              <Input
                id="nameEn"
                dir="ltr"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameAr">{t('nameArLabel')}</Label>
              <Input
                id="nameAr"
                dir="rtl"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">{t('cityLabel')}</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax">{t('taxLabel')}</Label>
              <Input
                id="tax"
                dir="ltr"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          {canManage && (
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {t('save')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('visibilityTitle')}</CardTitle>
          <CardDescription>{t('visibilitySubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={hideMargin}
              onChange={(e) => setHideMargin(e.target.checked)}
              disabled={disabled}
            />
            <span>
              <span className="block text-sm font-medium">
                {t('hideMarginLabel')}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t('hideMarginDesc')}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={restrictDash}
              onChange={(e) => setRestrictDash(e.target.checked)}
              disabled={disabled}
            />
            <span>
              <span className="block text-sm font-medium">
                {t('restrictDashLabel')}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t('restrictDashDesc')}
              </span>
            </span>
          </label>

          {canManage && (
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {t('save')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
