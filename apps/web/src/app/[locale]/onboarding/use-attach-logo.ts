'use client';

import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { uploadOrgLogo } from '@/lib/org/upload-org-logo';

/**
 * Attach the onboarding logo to the studio just created. The form is gone by
 * then (the studio exists, the page moves on), so a logo that did not attach is
 * told in a toast with its cause (a refused file, Storage, the network), never
 * raised: the studio is not undone by its logo.
 */
export function useAttachLogo(): (logo: File) => Promise<void> {
  const t = useTranslations('onboarding');
  const te = useTranslations('errors');
  return async (logo) => {
    let cause: string | null;
    try {
      const result = await uploadOrgLogo(logo);
      cause = result.ok ? null : describeFailure(result, te);
    } catch (rejection) {
      cause = describeRejection(rejection, te);
    }
    if (cause) toast({ title: t('logoUploadFailed'), description: cause, variant: 'destructive' });
  };
}
