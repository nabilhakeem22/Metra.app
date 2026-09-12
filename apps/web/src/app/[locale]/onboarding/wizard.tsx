'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { type FirmTypeKey } from '@/lib/entitlements/firm-types';
import {
  createLogoUpload,
  createOrg,
  setOrgLogo,
  type OrgProfileInput,
} from '@/lib/org/actions';
import { WizardStepConfirm } from './wizard-step-confirm';
import { WizardStepFirmType } from './wizard-step-firm-type';
import { WizardStepInvite } from './wizard-step-invite';
import { WizardStepProfile } from './wizard-step-profile';

const STEPS = 4;

export function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const th = useTranslations('hints.onboarding');
  const te = useTranslations('errors');
  const home = useTranslations('home');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState(1);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [firmType, setFirmType] = useState<FirmTypeKey>('interior');
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

  /**
   * Best-effort logo upload for the org just created. Never rethrows: the org
   * exists either way, so a failed logo is a toast, not a failed onboarding.
   */
  async function uploadLogo(file: File): Promise<void> {
    try {
      const signed = await createLogoUpload({
        contentType: file.type,
        originalName: file.name,
      });
      // A viewer (or a demoted user) is refused here — the catch below
      // surfaces the same logo-upload-failed toast.
      if ('ok' in signed) throw new Error('logo_forbidden');
      const uploaded = await fetch(signed.signedUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type, 'x-upsert': 'true' },
        body: file,
      });
      if (!uploaded.ok) {
        toast({ title: t('logoUploadFailed'), variant: 'destructive' });
        return;
      }
      await setOrgLogo(signed.fileId);
    } catch {
      toast({ title: t('logoUploadFailed'), variant: 'destructive' });
    }
  }

  function finish() {
    setError(null);
    startTransition(async () => {
      try {
        const input: OrgProfileInput = {
          nameEn: nameEn.trim() || null,
          nameAr: nameAr.trim() || null,
          firmType,
          city: city.trim() || null,
          taxRegistrationNumber: tax.trim() || null,
        };
        const res = await createOrg(input);
        if (!res.ok) {
          setError(resolveActionError(res.error, te));
          return;
        }

        if (logo) await uploadLogo(logo);

        toast({ title: t('createdTitle') });
        router.push('/dashboard');
      } catch {
        // Only an unexpected failure (network, a thrown logo step) lands here —
        // createOrg's own rejections are coded in res.error above.
        setError(resolveActionError(undefined, te));
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
        <WizardStepProfile
          t={t}
          th={th}
          nameEn={nameEn}
          setNameEn={setNameEn}
          nameAr={nameAr}
          setNameAr={setNameAr}
          city={city}
          setCity={setCity}
          tax={tax}
          setTax={setTax}
          logo={logo}
          logoPreview={logoPreview}
          pickLogo={pickLogo}
          removeLogo={removeLogo}
        />
      )}

      {step === 2 && (
        <WizardStepFirmType t={t} firmType={firmType} setFirmType={setFirmType} />
      )}

      {step === 3 && <WizardStepConfirm t={t} home={home} locale={locale} />}

      {step === 4 && <WizardStepInvite t={t} />}

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
            className="h-11"
            onClick={next}
            disabled={step === 1 && !canProceedStep1}
          >
            {t('next')}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-11"
            onClick={finish}
            disabled={pending}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {pending ? t('creating') : t('finish')}
          </Button>
        )}
      </div>
    </div>
  );
}
