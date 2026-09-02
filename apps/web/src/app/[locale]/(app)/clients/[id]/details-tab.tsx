'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { Client, ClientType } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { updateClient } from '@/lib/clients/actions';

const TYPES: ClientType[] = ['individual', 'company', 'consultant'];

interface FormState {
  nameEn: string;
  nameAr: string;
  type: ClientType;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  taxRegistrationNumber: string;
  notes: string;
}

function fromClient(c: Client): FormState {
  return {
    nameEn: c.nameEn ?? '',
    nameAr: c.nameAr ?? '',
    type: c.type,
    contactName: c.contactName ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    city: c.city ?? '',
    country: c.country ?? '',
    address: c.address ?? '',
    taxRegistrationNumber: c.taxRegistrationNumber ?? '',
    notes: c.notes ?? '',
  };
}

export function DetailsTab({
  client,
  canManage,
}: {
  client: Client;
  canManage: boolean;
}) {
  const t = useTranslations('clients');
  const th = useTranslations('hints.client');
  const te = useTranslations('errors');
  const router = useRouter();
  const [form, setForm] = useState<FormState>(fromClient(client));
  const [pending, startTransition] = useTransition();

  const set = (k: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    startTransition(async () => {
      const res = await updateClient({
        id: client.id,
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        type: form.type,
        contactName: form.contactName || null,
        email: form.email || null,
        phone: form.phone || null,
        city: form.city || null,
        country: form.country || null,
        address: form.address || null,
        taxRegistrationNumber: form.taxRegistrationNumber || null,
        // advancePct / retentionPct are deliberately ABSENT: this form no longer
        // owns them. updateClientCore leaves an omitted percentage untouched, so
        // the stored value (still served by Public API v1) survives an edit here.
        notes: form.notes || null,
      });
      if (res.ok) {
        toast({ title: t('profile.details.saved') });
        router.refresh();
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
    opts?: { dir?: 'ltr' | 'rtl'; hint?: string; inputMode?: 'decimal' },
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`d-${k}`} className="flex items-center">
        {label}
        {opts?.hint && <FieldHint id={`d-${k}-hint`} hint={opts.hint} />}
      </Label>
      <Input
        id={`d-${k}`}
        dir={opts?.dir ?? 'ltr'}
        inputMode={opts?.inputMode}
        aria-describedby={opts?.hint ? `d-${k}-hint` : undefined}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
        disabled={!canManage || pending}
      />
    </div>
  );

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('nameEn', t('form.nameEn'), { hint: th('name') })}
          {field('nameAr', t('form.nameAr'), { dir: 'rtl', hint: th('name') })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-type" className="flex items-center">
              {t('form.type')}
              <FieldHint id="d-type-hint" hint={th('type')} />
            </Label>
            <Select
              value={form.type}
              onValueChange={(v) => set('type')(v)}
              disabled={!canManage || pending}
            >
              <SelectTrigger id="d-type" aria-describedby="d-type-hint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    {t(`types.${ty}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {field('contactName', t('form.contactName'), { hint: th('contactName') })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('email', t('form.email'), { hint: th('email') })}
          {field('phone', t('form.phone'), { hint: th('phone') })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('city', t('form.city'), { hint: th('city') })}
          {field('country', t('form.country'))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('address', t('form.address'), { hint: th('address') })}
          {/* Advance / retention are NOT edited here any more: they are derived from
              the client's committed contracts and shown on the Financials tab. */}
          {field('taxRegistrationNumber', t('form.taxCode'), { hint: th('taxRegistrationNumber') })}
        </div>
        {field('notes', t('form.notes'))}

        {canManage && (
          <div className="flex justify-end">
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('profile.details.save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
