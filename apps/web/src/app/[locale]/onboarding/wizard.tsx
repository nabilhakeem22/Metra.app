'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { createOrg } from '@/lib/org/actions';
import { uploadOrgLogo } from '@/lib/org/upload-org-logo';
import { OnboardingProfileFields, type OnboardingProfileValues } from './onboarding-profile-fields';
import { fieldsAtLimit, fieldsOverLimit } from './profile-field-limits';

const EMPTY: OnboardingProfileValues = { nameEn: '', nameAr: '', city: '' };

/**
 * Onboarding is ONE screen: the studio's name (Arabic or English, one is
 * enough), its city and its logo, then "Create my studio" and the dashboard,
 * where the checklist leads to the first delivery. The firm type is the core's
 * default (interior, the only one on offer) and the tax number lives in
 * Settings, so neither costs a step here. Enter submits; a refusal renders
 * under the form.
 */
export function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<OnboardingProfileValues>(EMPTY);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const nameEn = values.nameEn.trim();
    const nameAr = values.nameAr.trim();
    if (!nameEn && !nameAr) {
      setError(t('errorRequired'));
      return;
    }
    // Over a cap the server would refuse with a bare "invalid": each such field
    // already says why under itself, so nothing is sent.
    if (fieldsOverLimit(values).length > 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createOrg({
          nameEn: nameEn || null,
          nameAr: nameAr || null,
          city: values.city.trim() || null,
        });
        if (!result.ok) {
          setError(resolveActionError(result.error, te));
          return;
        }
        if (logo && !(await uploadOrgLogo(logo))) {
          toast({ title: t('logoUploadFailed'), variant: 'destructive' });
        }
        toast({ title: t('createdTitle') });
        router.push('/dashboard');
      } catch {
        // Only an unexpected failure (the network) lands here: createOrg's own
        // refusals are coded in result.error above.
        setError(resolveActionError(undefined, te));
      }
    });
  }

  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      <div className="space-y-1">
        <h1 className="text-heading font-bold">{t('formTitle')}</h1>
        <p className="text-body text-muted-foreground">{t('hint')}</p>
      </div>
      <OnboardingProfileFields
        values={values}
        onChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))}
        atLimit={fieldsAtLimit(values)}
        logo={logo}
        logoPreview={logoPreview}
        pickLogo={pickLogo}
        removeLogo={removeLogo}
      />
      {error && (
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button variant="default" type="submit" className="h-11 w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? t('creating') : t('create')}
      </Button>
    </form>
  );
}
