'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
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
import { SettingsLogoField } from './settings-logo-field';

// The org profile card (logo · names · city · tax). The profile's state and
// save live in the parent (SettingsClient); the logo is its own field
// (SettingsLogoField), which uploads on pick and shows the saved logo.
export function SettingsProfileCard({
  t,
  th,
  savedLogoId,
  disabled,
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
  /** The saved logo's file id (also its cache key), or null when there is none. */
  savedLogoId: string | null;
  disabled: boolean;
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
        <SettingsLogoField savedLogoId={savedLogoId} disabled={disabled} />

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
          <Button variant="default" onClick={saveProfile} disabled={savingProfile}>
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
