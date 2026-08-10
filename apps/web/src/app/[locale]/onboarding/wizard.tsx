'use client';

import { Check, Loader2, Upload, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import {
  createLogoUpload,
  createOrg,
  setOrgLogo,
  type OrgProfileInput,
} from '@/lib/org/actions';

const STEPS = 3;

export function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const home = useTranslations('home');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState(1);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [city, setCity] = useState('');
  const [tax, setTax] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canProceedStep1 = nameEn.trim() !== '' || nameAr.trim() !== '';

  function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogo(file);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  function removeLogo() {
    setLogo(null);
    setLogoPreview(null);
  }

  function next() {
    if (step === 1 && !canProceedStep1) {
      setError(t('errorRequired'));
      return;
    }
    setError(null);
    setStep((s) => Math.min(STEPS, s + 1));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  function finish() {
    setError(null);
    startTransition(async () => {
      try {
        const input: OrgProfileInput = {
          nameEn: nameEn.trim() || null,
          nameAr: nameAr.trim() || null,
          city: city.trim() || null,
          taxRegistrationNumber: tax.trim() || null,
        };
        await createOrg(input);

        if (logo) {
          try {
            const signed = await createLogoUpload({
              contentType: logo.type,
              originalName: logo.name,
            });
            const res = await fetch(signed.signedUrl, {
              method: 'PUT',
              headers: { 'content-type': logo.type, 'x-upsert': 'true' },
              body: logo,
            });
            if (res.ok) {
              await setOrgLogo(signed.fileId);
            } else {
              toast({ title: t('logoUploadFailed'), variant: 'destructive' });
            }
          } catch {
            toast({ title: t('logoUploadFailed'), variant: 'destructive' });
          }
        }

        toast({ title: t('createdTitle') });
        router.push('/dashboard');
      } catch (e) {
        setError(e instanceof Error ? e.message : t('errorGeneric'));
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t('stepOf', { current: step, total: STEPS })}
        </p>
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors motion-reduce:transition-none ${
                i < step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('step1Title')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('hint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nameEn">{t('nameEnLabel')}</Label>
            <Input
              id="nameEn"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nameAr">{t('nameArLabel')}</Label>
            <Input
              id="nameAr"
              dir="rtl"
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
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('step2Title')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('confirmHint')}</p>
          </div>
          <dl className="divide-y rounded-xl border">
            <div className="flex items-center justify-between p-3">
              <dt className="text-sm text-muted-foreground">
                {t('confirmLanguage')}
              </dt>
              <dd className="text-sm font-medium">{home('localeName')}</dd>
            </div>
            <div className="flex items-center justify-between p-3">
              <dt className="text-sm text-muted-foreground">
                {t('confirmCurrency')}
              </dt>
              <dd className="text-sm font-medium">{t('currencyEgp')}</dd>
            </div>
          </dl>
          <input type="hidden" value={locale} readOnly />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('step3Title')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('inviteHint')}</p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-dashed p-4">
            <Check className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {t('inviteComingSoon')}
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={back}
          disabled={step === 1 || pending}
        >
          {t('back')}
        </Button>

        {step < STEPS ? (
          <Button
            type="button"
            onClick={next}
            disabled={step === 1 && !canProceedStep1}
          >
            {t('next')}
          </Button>
        ) : (
          <Button type="button" onClick={finish} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {pending ? t('creating') : t('finish')}
          </Button>
        )}
      </div>
    </div>
  );
}
