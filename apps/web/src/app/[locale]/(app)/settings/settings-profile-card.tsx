'use client';

import { Loader2, Upload } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The org profile card (logo · names · city · tax). All state and mutations
// live in the parent (SettingsClient); this child is presentational, driven by
// the passed values + callbacks.
export function SettingsProfileCard({
  t,
  th,
  logoPreview,
  onLogo,
  disabled,
  uploading,
  nameEn,
  setNameEn,
  nameAr,
  setNameAr,
  city,
  setCity,
  tax,
  setTax,
  canManage,
  saveProfile,
  savingProfile,
}: {
  t: ReturnType<typeof useTranslations<'settings'>>;
  th: ReturnType<typeof useTranslations<'hints.org'>>;
  logoPreview: string | null;
  onLogo: (e: ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  uploading: boolean;
  nameEn: string;
  setNameEn: (value: string) => void;
  nameAr: string;
  setNameAr: (value: string) => void;
  city: string;
  setCity: (value: string) => void;
  tax: string;
  setTax: (value: string) => void;
  canManage: boolean;
  saveProfile: () => void;
  savingProfile: boolean;
}) {
  return (
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
            <Label htmlFor="nameEn" className="flex items-center">
              {t('nameEnLabel')}
              <FieldHint id="org-name-hint" hint={th('name')} />
            </Label>
            <Input
              id="nameEn"
              dir="ltr"
              aria-describedby="org-name-hint"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nameAr" className="flex items-center">
              {t('nameArLabel')}
              <FieldHint id="org-namear-hint" hint={th('name')} />
            </Label>
            <Input
              id="nameAr"
              dir="rtl"
              aria-describedby="org-namear-hint"
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
  );
}
