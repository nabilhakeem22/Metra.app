'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { todayInCairo } from '@/lib/automation/clock';
import { recordContractPayment } from '@/lib/execution/payments/actions';
import {
  CONTRACT_PAYMENT_FIELDS,
  contractPaymentFieldErrors,
  type ContractPaymentField,
} from '@/lib/execution/payments/input';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';
import { useAttemptKey } from './use-attempt-key';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const recordPaymentControlId = (field: ContractPaymentField) => `record-payment-${field}`;

/**
 * Money received against one payment request: the amount (as studios type it,
 * rewritten to the saved figure on blur), the day, and optional method,
 * reference and note. Offered to the roles with `payments` create; the server
 * checks again. Every refusal is said under its box, a payment past what is due
 * under the amount with that figure. The amount opens on what is due.
 */
export function RecordPaymentDialog({
  request,
  m,
  onRecorded,
}: {
  request: { id: string; documentNumber: string; outstanding: string };
  m: (value: string) => string;
  onRecorded: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.record');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [open, setOpen] = useState(false);
  const today = todayInCairo(new Date());
  const [typed, setTyped] = useState({ amount: '', receivedOn: today, method: '', reference: '', note: '' });
  const [already, setAlready] = useState(false);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: CONTRACT_PAYMENT_FIELDS, translate: te });
  const attempt = useAttemptKey();

  const box = (field: ContractPaymentField) => ({
    value: typed[field],
    onChange: (event: { target: { value: string } }) => setTyped((current) => ({ ...current, [field]: event.target.value })),
  });

  function openDialog() {
    setTyped({ amount: request.outstanding.replace(/\.?0+$/, ''), receivedOn: today, method: '', reference: '', note: '' });
    setAlready(false);
    errors.clear();
    setOpen(true);
  }

  function submit() {
    if (errors.applyLocal(contractPaymentFieldErrors(typed, today))) return;
    const idempotencyKey = attempt.claim(JSON.stringify([request.id, typed]));
    startTransition(async () => {
      try {
        const res = await recordContractPayment({ requestId: request.id, ...typed, idempotencyKey });
        attempt.settle(res);
        if (errors.applyResult(res)) return;
        // The first attempt landed and only its answer was lost: say so, and show it in the ledger.
        if (res.already) {
          setAlready(true);
          onRecorded();
          return;
        }
        setOpen(false);
        onRecorded();
      } catch (rejection) {
        attempt.settle('rejected');
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openDialog}>
        {t('open')}
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={t('title', { request: request.documentNumber })}
        description={t('description')}
        onSubmit={submit}
        submitLabel={t('submit')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        pending={pending}
        formError={errors.formError ?? (already ? t('already') : null)}
        invalidAttempt={errors.invalidAttempt}
      >
        <p className="text-body">
          {t('due')} <span dir="ltr" className="font-mono tabular-nums">{m(request.outstanding)}</span>
        </p>
        <FormField id={recordPaymentControlId('amount')} label={t('amount')} required {...errors.bind('amount')}>
          <Input
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            {...box('amount')}
            onBlur={(event) => setTyped((current) => ({ ...current, amount: normalizeDecimalInput(event.target.value) }))}
          />
        </FormField>
        <FormField id={recordPaymentControlId('receivedOn')} label={t('receivedOn')} required {...errors.bind('receivedOn')}>
          <Input type="date" dir="ltr" max={today} {...box('receivedOn')} />
        </FormField>
        <FormField id={recordPaymentControlId('method')} label={t('method')} {...errors.bind('method')}>
          <Input {...box('method')} />
        </FormField>
        <FormField id={recordPaymentControlId('reference')} label={t('reference')} {...errors.bind('reference')}>
          <Input dir="ltr" {...box('reference')} />
        </FormField>
        <FormField id={recordPaymentControlId('note')} label={t('note')} {...errors.bind('note')}>
          <Textarea {...box('note')} />
        </FormField>
      </FormSheet>
    </>
  );
}
