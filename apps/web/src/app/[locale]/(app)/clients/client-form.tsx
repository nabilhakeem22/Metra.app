'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createClient, updateClient } from '@/lib/clients/actions';
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
  const [form, setForm] = useState<ClientFormState>(EMPTY);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
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

  function submit() {
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
      const res = item
        ? await updateClient({ id: item.id, ...payload })
        : await createClient(payload);
      if (res.ok) {
        toast({ title: t(item ? 'toast.updated' : 'toast.created') });
        onOpenChange(false);
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t(item ? 'form.editTitle' : 'form.newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t(item ? 'form.editTitle' : 'form.newTitle')}
        </SheetDescription>

        <div className="mt-4 space-y-4">
          <ClientFormFields
            form={form}
            set={set}
            isCreate={!item}
            more={{ open: moreOpen, toggle: () => setMoreOpen((wasOpen) => !wasOpen) }}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('form.cancel')}
            </Button>
            <Button variant="default" type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('form.save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
