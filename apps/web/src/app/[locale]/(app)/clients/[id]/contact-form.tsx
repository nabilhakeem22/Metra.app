'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createContact, updateContact } from '@/lib/client-contacts/actions';
import { contactFieldFor, type ContactFormField } from './contact-form-errors';
import { contactPayload, validateDraft, type ContactDraft } from './contact-draft';

/** The boxes that differ only in their key and their direction. */
const TEXT_FIELDS = [
  { key: 'name', ltr: false },
  { key: 'role', ltr: false },
  { key: 'phone', ltr: true },
  { key: 'email', ltr: true },
  { key: 'whatsapp', ltr: true },
] as const;

/** Add or edit one contact, in the app's form sheet. The tab owns the draft. */
export function ContactForm({
  clientId,
  open,
  onOpenChange,
  draft,
  onDraftChange,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ContactDraft;
  onDraftChange: (draft: ContactDraft) => void;
}) {
  const t = useTranslations('clients.profile.contacts');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ code: ActionCode; field: ContactFormField } | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const messageFor = (field: ContactFormField) =>
    error?.field === field ? resolveActionError(error.code, te) : undefined;

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = contactPayload(draft);
      try {
        const result = draft.id
          ? await updateContact({ id: draft.id, ...payload })
          : await createContact({ clientId, ...payload, isPrimary: draft.isPrimary });
        if (result.ok) {
          onOpenChange(false);
          router.refresh();
          return;
        }
        const code = (result.error as ActionCode) ?? 'generic';
        setError({ code, field: contactFieldFor(code) });
      } catch {
        setError({ code: 'generic', field: 'form' });
      }
    });
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={draft.id ? t('editTitle') : t('newTitle')}
      onSubmit={submit}
      submitLabel={draft.id ? t('save') : t('add')}
      cancelLabel={t('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      canSubmit={validateDraft(draft)}
      formError={messageFor('form')}
    >
      {TEXT_FIELDS.map((field) => (
        <FormField
          key={field.key}
          id={`ct-${field.key}`}
          label={t(field.key)}
          required={field.key === 'name'}
          error={field.key === 'name' ? messageFor('name') : undefined}
        >
          <Input
            dir={field.ltr ? 'ltr' : 'auto'}
            value={draft[field.key]}
            onChange={(event) => onDraftChange({ ...draft, [field.key]: event.target.value })}
          />
        </FormField>
      ))}
      {/* Only on CREATE: an existing contact is promoted with its own action,
          which is also the only one that demotes the current primary. */}
      {!draft.id && (
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={draft.isPrimary}
            onChange={(event) => onDraftChange({ ...draft, isPrimary: event.target.checked })}
          />
          {t('primaryOnCreate')}
        </label>
      )}
    </FormSheet>
  );
}
