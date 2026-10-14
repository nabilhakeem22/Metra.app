'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { createContact, updateContact } from '@/lib/client-contacts/actions';
import { contactFieldErrors } from '@/lib/client-contacts/field-rules';
import { CONTACT_FIELDS, type ContactField } from '@/lib/client-contacts/fields';
import { contactPayload, type ContactDraft } from './contact-draft';

/** The boxes that differ only in their key and their direction. */
const TEXT_FIELDS: ReadonlyArray<{ key: ContactField; ltr: boolean }> = [
  { key: 'name', ltr: false },
  { key: 'role', ltr: false },
  { key: 'phone', ltr: true },
  { key: 'email', ltr: true },
  { key: 'whatsapp', ltr: true },
];

/** The control a contact field's refusal sits under. */
export function contactControlId(field: ContactField): string {
  return `ct-${field}`;
}

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
  const errors = useFieldErrors({ fields: CONTACT_FIELDS, translate: te });
  const { clear } = errors;

  useEffect(() => {
    if (open) clear();
  }, [open, clear]);

  function submit() {
    const payload = contactPayload(draft);
    if (errors.applyLocal(contactFieldErrors(payload))) return;
    startTransition(async () => {
      try {
        const result = draft.id
          ? await updateContact({ id: draft.id, ...payload })
          : await createContact({ clientId, ...payload, isPrimary: draft.isPrimary });
        if (errors.applyResult(result)) return;
        onOpenChange(false);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
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
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      {TEXT_FIELDS.map((field) => (
        <FormField
          key={field.key}
          id={contactControlId(field.key)}
          label={t(field.key)}
          required={field.key === 'name'}
          {...errors.bind(field.key)}
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
