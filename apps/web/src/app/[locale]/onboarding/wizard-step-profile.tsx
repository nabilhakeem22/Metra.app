'use client';

import { Upload, X } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Step 1 of the onboarding wizard: firm identity (names, city, tax) + logo.
// Purely presentational — all state, setters and the useTranslations hooks live
// in the parent OnboardingWizard and arrive here as props (verbatim JSX).
export function WizardStepProfile({
  t,
  th,
  nameEn,
  setNameEn,
  nameAr,
  setNameAr,
  city,
  setCity,
  tax,
  setTax,
  logo,
  logoPreview,
  pickLogo,
  removeLogo,
}: {
  t: ReturnType<typeof useTranslations<'onboarding'>>;
  th: ReturnType<typeof useTranslations<'hints.onboarding'>>;
  nameEn: string;
  setNameEn: (value: string) => void;
  nameAr: string;
  setNameAr: (value: string) => void;
  city: string;
  setCity: (value: string) => void;
  tax: string;
  setTax: (value: string) => void;
  logo: File | null;
  logoPreview: string | null;
  pickLogo: (e: ChangeEvent<HTMLInputElement>) => void;
  removeLogo: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('step1Title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nameEn" className="flex items-center">
          {t('nameEnLabel')}
          <FieldHint id="onb-name-hint" hint={th('orgName')} />
        </Label>
        <Input
          id="nameEn"
          dir="ltr"
          aria-describedby="onb-name-hint"
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nameAr" className="flex items-center">
          {t('nameArLabel')}
          <FieldHint id="onb-namear-hint" hint={th('orgName')} />
        </Label>
        <Input
          id="nameAr"
          dir="rtl"
          aria-describedby="onb-namear-hint"
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="city">{t('cityLabel')}</Label>
        <Input
          id="city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tax">{t('taxLabel')}</Label>
        <Input
          id="tax"
          dir="ltr"
          value={tax}
          onChange={(e) => setTax(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('logoLabel')}</Label>
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
            onChange={pickLogo}
          />
          <Label
            htmlFor="logo"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted"
          >
            {t('logoChoose')}
          </Label>
          {logo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeLogo}
            >
              <X className="size-4" aria-hidden />
              {t('logoRemove')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
