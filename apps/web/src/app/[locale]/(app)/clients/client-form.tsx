'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormSheet } from '@/components/ui/form-sheet';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createClient, updateClient } from '@/lib/clients/actions';
import { clientFieldFor, type ClientFormField } from './client-form-errors';
import { ClientFormFields, type ClientFormState } from './client-form-fields';
import type { ClientRow } from './types';

export interface ClientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ClientRow | null;
}

const EMPTY: ClientFormState = {
  nameEn: '',
  nameAr: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  country: '',
  address: '',
  taxRegistrationNumber: '',
  notes: '',
};

export function ClientForm({ open, onOpenChange, item }: ClientFormProps) {
  const t = useTranslations('clients');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const [form, setForm] = useState<ClientFormState>(EMPTY);
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<{ code: ActionCode; field: ClientFormField } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setError(null);
    // "More details" starts open only for an edited client that has any of them.
    setMoreOpen(Boolean(item && (item.taxRegistrationNumber || item.address || item.notes)));
    setForm(
      item
        ? {
            nameEn: item.nameEn ?? '',
            nameAr: item.nameAr ?? '',
            contactName: item.contactName ?? '',
            email: item.email ?? '',
            phone: item.phone ?? '',
            city: item.city ?? '',
            country: item.country ?? '',
            address: item.address ?? '',
            taxRegistrationNumber: item.taxRegistrationNumber ?? '',
            notes: item.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, item]);

  const set = (k: keyof ClientFormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const messageFor = (field: ClientFormField) =>
    error?.field === field ? resolveActionError(error.code, te) : undefined;

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        contactName: form.contactName || null,
        email: form.email || null,
        phone: form.phone || null,
        city: form.city || null,
        country: form.country || null,
        address: form.address || null,
        taxRegistrationNumber: form.taxRegistrationNumber || null,
        notes: form.notes || null,
      };
      try {
        const res = item
          ? await updateClient({ id: item.id, ...payload })
          : await createClient(payload);
        if (res.ok) {
          toast({ title: t(item ? 'toast.updated' : 'toast.created') });
          onOpenChange(false);
          return;
        }
        const code = (res.error as ActionCode) ?? 'generic';
        setError({ code, field: clientFieldFor(code) });
      } catch {
        setError({ code: 'generic', field: 'form' });
      }
    });
  }

  const title = t(item ? 'form.editTitle' : 'form.newTitle');
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onSubmit={submit}
      submitLabel={t('form.save')}
      cancelLabel={t('form.cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={messageFor('form')}
    >
      <ClientFormFields
        form={form}
        set={set}
        isCreate={!item}
        more={{ open: moreOpen, toggle: () => setMoreOpen((wasOpen) => !wasOpen) }}
        errors={{ name: messageFor('name'), phone: messageFor('phone') }}
      />
    </FormSheet>
  );
}
