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
  address: string;
  taxRegistrationNumber: string;
  commercialRegister: string;
  taxCardNumber: string;
  nationalId: string;
  segment: string;
  leadSource: string;
  creditTerms: string;
  advancePct: string;
  retentionPct: string;
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
    address: c.address ?? '',
    taxRegistrationNumber: c.taxRegistrationNumber ?? '',
    commercialRegister: c.commercialRegister ?? '',
    taxCardNumber: c.taxCardNumber ?? '',
    nationalId: c.nationalId ?? '',
    segment: c.segment ?? '',
    leadSource: c.leadSource ?? '',
    creditTerms: c.creditTerms ?? '',
    advancePct: c.advancePct,
    retentionPct: c.retentionPct,
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
        address: form.address || null,
        taxRegistrationNumber: form.taxRegistrationNumber || null,
        commercialRegister: form.commercialRegister || null,
        taxCardNumber: form.taxCardNumber || null,
        nationalId: form.nationalId || null,
        segment: form.segment || null,
        leadSource: form.leadSource || null,
        creditTerms: form.creditTerms || null,
        advancePct: form.advancePct || '0',
        retentionPct: form.retentionPct || '0',
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
            <select
              id="d-type"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              aria-describedby="d-type-hint"
              value={form.type}
              onChange={(e) => set('type')(e.target.value)}
              disabled={!canManage || pending}
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`types.${ty}`)}
                </option>
              ))}
            </select>
          </div>
          {field('segment', t('form.segment'), { hint: th('segment') })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('contactName', t('form.contactName'), { hint: th('contactName') })}
          {field('leadSource', t('form.leadSource'), { hint: th('leadSource') })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('email', t('form.email'), { hint: th('email') })}
          {field('phone', t('form.phone'), { hint: th('phone') })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('city', t('form.city'), { hint: th('city') })}
          {field('address', t('form.address'), { hint: th('address') })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field('taxRegistrationNumber', t('form.taxCode'), { hint: th('taxRegistrationNumber') })}
          {field('commercialRegister', t('form.commercialRegister'), { hint: th('commercialRegister') })}
          {field('taxCardNumber', t('form.taxCardNumber'), { hint: th('taxCardNumber') })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field('nationalId', t('form.nationalId'), { hint: th('nationalId') })}
          {field('advancePct', t('form.advancePct'), { hint: th('advancePct'), inputMode: 'decimal' })}
          {field('retentionPct', t('form.retentionPct'), { hint: th('retentionPct'), inputMode: 'decimal' })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('creditTerms', t('form.creditTerms'), { hint: th('creditTerms') })}
          {field('notes', t('form.notes'))}
        </div>

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
