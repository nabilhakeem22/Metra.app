'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { requestMarketSeed } from '@/lib/market-book/seed-request';
import { createOrg } from '@/lib/org/actions';
import { orgProfileFieldErrors } from '@/lib/org/profile-field-rules';
import { OnboardingProfileFields, type OnboardingProfileValues } from './onboarding-profile-fields';
import { ONBOARDING_FIELDS, fieldsAtLimit } from './profile-field-limits';
import { useAttachLogo } from './use-attach-logo';

const EMPTY: OnboardingProfileValues = { nameEn: '', nameAr: '', city: '' };


/**
 * Onboarding is ONE screen: the studio's name (Arabic or English, one is
 * enough), its city and its logo, then "Create my studio" and the dashboard,
 * where the checklist leads to the first delivery. The firm type is the core's
 * default (interior, the only one on offer) and the tax number lives in
 * Settings, so neither costs a step here. Enter submits; a refusal is said
 * under its field, and one no field owns under the form.
 */
export function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<OnboardingProfileValues>(EMPTY);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const errors = useFieldErrors({ fields: ONBOARDING_FIELDS, translate: te });
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  const attachLogo = useAttachLogo();

  function pickLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setLogo(file);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  function removeLogo() {
    setLogo(null);
    setLogoPreview(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const profile = {
      nameEn: values.nameEn.trim() || null,
      nameAr: values.nameAr.trim() || null,
      city: values.city.trim() || null,
    };
    if (errors.applyLocal(orgProfileFieldErrors(profile))) return;
    startTransition(async () => {
      try {
        const result = await createOrg(profile);
        if (errors.applyResult(result)) return;
        if (logo) await attachLogo(logo);
        // The new studio's market price book, in a request of its own (a
        // Worker's CPU budget is per request), never awaited and silent on
        // failure: the server logs it, and the empty price book offers the load.
        requestMarketSeed();
        toast({ title: t('createdTitle') });
        router.push('/dashboard');
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <form ref={formRef} className="space-y-6" onSubmit={submit} noValidate>
      <div className="space-y-1">
        <h1 className="text-heading font-bold">{t('formTitle')}</h1>
        <p className="text-body text-muted-foreground">{t('hint')}</p>
      </div>
      <OnboardingProfileFields
        values={values}
        onChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))}
        atLimit={fieldsAtLimit(values)}
        bind={errors.bind}
        logo={logo}
        logoPreview={logoPreview}
        pickLogo={pickLogo}
        removeLogo={removeLogo}
      />
      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}
      <Button variant="default" type="submit" className="h-11 w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? t('creating') : t('create')}
      </Button>
    </form>
  );
}
