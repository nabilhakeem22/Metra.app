'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormSheet } from '@/components/ui/form-sheet';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { createClient, updateClient } from '@/lib/clients/actions';
import { clientFieldErrors } from '@/lib/clients/field-rules';
import { CLIENT_FORM_FIELDS } from '@/lib/clients/fields';
import { ClientFormFields } from './client-form-fields';
import {
  clientFormOf,
  clientPayload,
  EMPTY_CLIENT_FORM,
  FOLDED_CLIENT_FIELDS,
  type ClientFormState,
} from './client-form-state';
import type { ClientRow } from './types';

export interface ClientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ClientRow | null;
}

/**
 * Add or edit one client. Save checks the typed values first and says what is
 * wrong under each field (all of them at once); what only the server knows
 * comes back the same way. A refusal under a folded field unfolds it.
 */
export function ClientForm({ open, onOpenChange, item }: ClientFormProps) {
  const t = useTranslations('clients');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const [form, setForm] = useState<ClientFormState>(EMPTY_CLIENT_FORM);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: CLIENT_FORM_FIELDS, translate: te });
  const { clear } = errors;

  useEffect(() => {
    if (!open) return;
    clear();
    // "More details" starts open only for an edited client that has any of them.
    setMoreOpen(Boolean(item && (item.taxRegistrationNumber || item.address || item.notes)));
    setForm(item ? clientFormOf(item) : EMPTY_CLIENT_FORM);
  }, [open, item, clear]);

  const set = (key: keyof ClientFormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  /** Open "More details" in the same render as the refusal, so focus can land. */
  function unfoldFor(refused: FieldErrors | undefined): void {
    if (FOLDED_CLIENT_FIELDS.some((field) => refused?.[field])) setMoreOpen(true);
  }

  function submit() {
    const payload = clientPayload(form);
    // A phone that exists may not be blanked; a legacy client without one stays editable.
    const local = clientFieldErrors(payload, { phoneRequired: !item || Boolean(item.phone) });
    if (errors.applyLocal(local)) return unfoldFor(local);
    startTransition(async () => {
      try {
        const result = item
          ? await updateClient({ id: item.id, ...payload })
          : await createClient(payload);
        if (errors.applyResult(result)) return unfoldFor(result.fields);
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(item ? 'form.editTitle' : 'form.newTitle')}
      onSubmit={submit}
      submitLabel={t('form.save')}
      cancelLabel={t('form.cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <ClientFormFields
        form={form}
        set={set}
        isCreate={!item}
        more={{ open: moreOpen, toggle: () => setMoreOpen((wasOpen) => !wasOpen) }}
        bind={errors.bind}
      />
    </FormSheet>
  );
}
