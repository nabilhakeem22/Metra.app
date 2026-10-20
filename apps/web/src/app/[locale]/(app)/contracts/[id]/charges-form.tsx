'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Row } from '@/components/share/link-page-parts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { useRouter } from '@/i18n/routing';
import { setContractCharges } from '@/lib/contracts/actions';
import {
  CONTRACT_CHARGE_FIELDS,
  contractChargeFieldErrors,
  type ContractChargeField,
  type ContractChargeRates,
} from '@/lib/contracts/charges-input';
import type { ContractHeaderDetail } from '@/lib/contracts/queries';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';

/** The DOM id of a rate box: its refusal sits under it. */
export const chargeControlId = (field: ContractChargeField) => `charges-${field}`;

const plain = (value: string) => value.replace(/\.?0+$/, '') || '0';

/**
 * A draft execution contract's VAT and supervision fee, on the BOQ total
 * (its works value, never edited here). Each refusal is said under its box; a
 * refusal of the contract itself (issued meanwhile) above the Save button.
 */
export function ChargesForm({ detail, m }: { detail: ContractHeaderDetail; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.charges');
  const tc = useTranslations('contracts');
  const te = useTranslations('errors');
  const router = useRouter();
  const [rates, setRates] = useState<ContractChargeRates>({
    taxRate: plain(detail.taxRate),
    supervisionPct: plain(detail.supervisionPct),
  });
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: CONTRACT_CHARGE_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);

  function save() {
    if (errors.applyLocal(contractChargeFieldErrors(rates))) return;
    startTransition(async () => {
      try {
        const res = await setContractCharges({ contractId: detail.id, ...rates });
        if (errors.applyResult(res)) return;
        setSaved(true);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  const rateBox = (field: ContractChargeField) => (
    <FormField id={chargeControlId(field)} label={t(field)} required {...errors.bind(field)}>
      <Input
        dir="ltr"
        inputMode="decimal"
        className="tabular-nums"
        value={rates[field]}
        onChange={(event) => {
          setSaved(false);
          setRates((current) => ({ ...current, [field]: event.target.value }));
        }}
        onBlur={(event) => setRates((current) => ({ ...current, [field]: normalizeDecimalInput(event.target.value) }))}
      />
    </FormField>
  );

  return (
    <Card>
      <CardContent ref={formRef} className="space-y-3 py-4">
        <h2 className="text-body font-semibold">{t('title')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rateBox('taxRate')}
          {rateBox('supervisionPct')}
        </div>
        <div className="max-w-xs space-y-1 text-body">
          <Row label={t('worksValue')} value={m(detail.taxableBase)} />
          <Row label={t('taxAmount')} value={m(detail.taxAmount)} />
          <Row label={t('supervisionAmount')} value={m(detail.supervisionAmount)} />
          <Row label={t('originalValue')} value={m(detail.originalValue)} bold />
        </div>
        {errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {errors.formError}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('save')}
          </Button>
          {saved && <span className="text-body text-[color:var(--success)]">{tc('saved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
