'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { generateExecutionContract } from '@/lib/contracts/actions';
import {
  CONTRACT_CHARGE_FIELDS,
  DEFAULT_CONTRACT_CHARGES,
  contractChargeFieldErrors,
  type ContractChargeField,
} from '@/lib/contracts/charges-input';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';

/** The DOM id of a rate box: the dialog's refusals sit under these. */
export const generateChargeControlId = (field: ContractChargeField) => `generate-${field}`;

/**
 * "Create the execution contract" from an issued BOQ (the BOQ tab and the
 * delivery's execution card). The studio sets VAT and the supervision fee; the
 * works value is the BOQ total. A refusal of a rate is said under its box, one
 * of the BOQ itself (no longer issued, a contract already made) above the
 * footer. On success the new draft contract opens.
 */
export function GenerateExecutionContract({ boqId }: { boqId: string }) {
  const t = useTranslations('contracts.execution.generate');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState(DEFAULT_CONTRACT_CHARGES);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: CONTRACT_CHARGE_FIELDS, translate: te });

  function submit() {
    if (errors.applyLocal(contractChargeFieldErrors(rates))) return;
    startTransition(async () => {
      try {
        const res = await generateExecutionContract({ boqId, ...rates });
        if (errors.applyResult(res) || !res.data) return;
        setOpen(false);
        router.push(`/contracts/${res.data}`);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  const rateBox = (field: ContractChargeField) => (
    <FormField id={generateChargeControlId(field)} label={t(field)} required {...errors.bind(field)}>
      <Input
        dir="ltr"
        inputMode="decimal"
        className="tabular-nums"
        value={rates[field]}
        onChange={(event) => setRates((current) => ({ ...current, [field]: event.target.value }))}
        onBlur={(event) => setRates((current) => ({ ...current, [field]: normalizeDecimalInput(event.target.value) }))}
      />
    </FormField>
  );

  return (
    <>
      <Button variant="default" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('description')}
        onSubmit={submit}
        submitLabel={t('submit')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        pending={pending}
        formError={errors.formError}
        invalidAttempt={errors.invalidAttempt}
      >
        {rateBox('taxRate')}
        {rateBox('supervisionPct')}
      </FormSheet>
    </>
  );
}
