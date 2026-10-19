'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { useRouter } from '@/i18n/routing';
import { saveContractDraft } from '@/lib/contracts/actions';
import type { ContractHeaderDetail } from '@/lib/contracts/queries';
import {
  CONTRACT_HEADER_FIELDS,
  contractHeaderInput,
  headerFormOf,
  type HeaderForm,
} from './contract-header-input';

type HeaderKey = keyof HeaderForm;

const KIND: Partial<Record<HeaderKey, 'date' | 'number'>> = {
  advancePct: 'number',
  retentionPct: 'number',
  signatureDate: 'date',
  startDate: 'date',
  endDate: 'date',
  paymentTermsDays: 'number',
  defectsLiabilityDays: 'number',
};

/**
 * Draft-only header editor — wires the tested saveContractDraftCore so staff set
 * retention/advance/terms/dates/payment terms before issuing. Each refused field
 * is said under it (a percentage outside 0 to 100, a day that is not one, an end
 * before the start); a refusal of the contract itself (`contract_not_draft`:
 * it was issued meanwhile) is said above the fields.
 */
export function ContractHeaderForm({ detail }: { detail: ContractHeaderDetail }) {
  const t = useTranslations('contracts');
  const th = useTranslations('contracts.header');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<HeaderForm>(() => headerFormOf(detail));
  const errors = useFieldErrors({ fields: CONTRACT_HEADER_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);

  function save() {
    errors.clear();
    startTransition(async () => {
      try {
        const res = await saveContractDraft({ id: detail.id, header: contractHeaderInput(form) });
        if (errors.applyResult(res)) return;
        setSaved(true);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  const field = (key: HeaderKey, label: string) => {
    const kind = KIND[key];
    return (
      <FormField id={`ch-${key}`} label={label} {...errors.bind(key)}>
        <Input
          type={kind ?? 'text'}
          dir={kind ? 'ltr' : undefined}
          value={form[key]}
          onChange={(e) => {
            setForm((f) => ({ ...f, [key]: e.target.value }));
            setSaved(false);
          }}
        />
      </FormField>
    );
  };

  return (
    <Card>
      <CardContent ref={formRef} className="space-y-3 py-4">
        <h2 className="text-body font-semibold">{t('contract')}</h2>
        {errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {errors.formError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('advancePct', th('advancePct'))}
          {field('retentionPct', th('retentionPct'))}
          {field('signatureDate', th('signatureDate'))}
          {field('startDate', th('startDate'))}
          {field('endDate', th('endDate'))}
          {field('paymentTermsDays', th('paymentTermsDays'))}
          {field('defectsLiabilityDays', th('defectsLiabilityDays'))}
        </div>
        {field('termsEn', th('terms'))}
        {field('termsAr', th('terms'))}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('saveDraft')}
          </Button>
          {saved && <span className="text-body text-[color:var(--success)]">{t('saved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
