'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { ClientRow } from './types';

export interface ClientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ClientRow | null;
}

interface FormState {
  nameEn: string;
  nameAr: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  taxRegistrationNumber: string;
  notes: string;
}

const EMPTY: FormState = {
  nameEn: '',
  nameAr: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  address: '',
  taxRegistrationNumber: '',
  notes: '',
};

export function ClientForm({ open, onOpenChange, item }: ClientFormProps) {
  const t = useTranslations('clients');
  const th = useTranslations('hints.client');
  const te = useTranslations('errors');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setForm(
      item
        ? {
            nameEn: item.nameEn ?? '',
            nameAr: item.nameAr ?? '',
            contactName: item.contactName ?? '',
            email: item.email ?? '',
            phone: item.phone ?? '',
            city: item.city ?? '',
            address: item.address ?? '',
            taxRegistrationNumber: item.taxRegistrationNumber ?? '',
            notes: item.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, item]);

  const set = (k: keyof FormState) => (v: string) =>
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

  const field = (
    k: keyof FormState,
    label: string,
    dir: 'ltr' | 'rtl' = 'ltr',
    hint?: string,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`cl-${k}`} className="flex items-center">
        {label}
        {hint && <FieldHint id={`cl-${k}-hint`} hint={hint} />}
      </Label>
      <Input
        id={`cl-${k}`}
        dir={dir}
        aria-describedby={hint ? `cl-${k}-hint` : undefined}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
      />
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{t(item ? 'form.editTitle' : 'form.newTitle')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t(item ? 'form.editTitle' : 'form.newTitle')}
        </SheetDescription>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field('nameEn', t('form.nameEn'), 'ltr', th('name'))}
            {field('nameAr', t('form.nameAr'), 'rtl', th('name'))}
          </div>
          {field('contactName', t('form.contactName'), 'ltr', th('contactName'))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field('email', t('form.email'), 'ltr', th('email'))}
            {field('phone', t('form.phone'), 'ltr', th('phone'))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field('city', t('form.city'), 'ltr', th('city'))}
            {field('taxRegistrationNumber', t('form.taxCode'), 'ltr', th('taxRegistrationNumber'))}
          </div>
          {field('address', t('form.address'), 'ltr', th('address'))}
          {field('notes', t('form.notes'), 'ltr', th('notes'))}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('form.cancel')}
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('form.save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
