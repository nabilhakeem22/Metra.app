'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { updateOrgSettings } from '@/lib/org/actions';

/**
 * Save the two visibility switches. A pair of switches has no field to say a
 * refusal under, so the toast names the cause (D11).
 */
export function useSaveVisibility(): {
  saving: boolean;
  save: (settings: { hideMarginFromPm: boolean; restrictFirmDashboard: boolean }) => void;
} {
  const t = useTranslations('settings');
  const te = useTranslations('errors');
  const [saving, startSaving] = useTransition();

  function save(settings: { hideMarginFromPm: boolean; restrictFirmDashboard: boolean }) {
    startSaving(async () => {
      try {
        const result = await updateOrgSettings(settings);
        toast(result.ok ? { title: t('saved') } : { title: describeFailure(result, te), variant: 'destructive' });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  return { saving, save };
}
