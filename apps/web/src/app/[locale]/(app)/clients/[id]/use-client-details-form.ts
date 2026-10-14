'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { Client, ClientType } from '@metra/db';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { updateClient } from '@/lib/clients/actions';
import { clientFieldErrors } from '@/lib/clients/field-rules';
import { CLIENT_FORM_FIELDS } from '@/lib/clients/fields';
import { clientFormOf, clientPayload, type ClientFormState } from '../client-form-state';

export interface ClientDetailsDraft extends ClientFormState {
  type: ClientType;
}

/**
 * The client Details tab's state and Save. The same rules as the client sheet,
 * checked before sending and said under each field; a phone that exists may
 * not be blanked. The percentages are deliberately not sent: they live on
 * Financials, and updateClientCore leaves an omitted one as it was.
 */
export function useClientDetailsForm(client: Client) {
  const t = useTranslations('clients');
  const te = useTranslations('errors');
  const router = useRouter();
  const [form, setForm] = useState<ClientDetailsDraft>(() => ({
    ...clientFormOf(client),
    type: client.type,
  }));
  const [saving, startSaving] = useTransition();
  const errors = useFieldErrors({ fields: CLIENT_FORM_FIELDS, translate: te });

  function set<K extends keyof ClientDetailsDraft>(key: K, value: ClientDetailsDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const payload = { ...clientPayload(form), type: form.type };
    if (errors.applyLocal(clientFieldErrors(payload, { phoneRequired: Boolean(client.phone) }))) return;
    startSaving(async () => {
      try {
        const result = await updateClient({ id: client.id, ...payload });
        if (errors.applyResult(result)) return;
        toast({ title: t('profile.details.saved') });
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { form, set, save, saving, errors };
}
