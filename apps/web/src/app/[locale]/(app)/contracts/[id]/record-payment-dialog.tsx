'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { todayInCairo } from '@/lib/automation/clock';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { recordContractPayment } from '@/lib/execution/payments/actions';
import {
  CONTRACT_PAYMENT_FIELDS,
  contractPaymentFieldErrors,
  readContractPayment,
  type ContractPaymentField,
} from '@/lib/execution/payments/input';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';
import { withMoneyParams } from './money-error-params';
import { paymentActOf } from './payment-attempt-store';
import { usePaymentAttempt } from './use-payment-attempt';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const recordPaymentControlId = (field: ContractPaymentField) => `record-payment-${field}`;

type TypedPayment = Record<ContractPaymentField, string>;

/**
 * Money received against one payment request: the amount (as studios type it,
 * rewritten to the saved figure on blur), the day, and optional method,
 * reference and note. Offered to the roles with `payments` create; the server
 * checks again. Every refusal is said under its box, a payment past what is due
 * under the amount with that figure. The amount opens on what is due.
 *
 * A LOST ANSWER NEVER BECOMES A SECOND PAYMENT (A4 F1, F2). The key is held per
 * request across a close, a tab switch and a remount (use-payment-attempt.ts):
 * the same payment retried carries it, and the server answers the row it
 * already has. A different payment while that key is held is not sent: the
 * dialog says the first may be recorded and offers to check the payments, and
 * only once they were read again does a new key exist. Any answer closes the
 * dialog when it says what happened, "already recorded" included, so Save is
 * never left live on a payment that was counted; every answer re-reads the tab.
 */
export function RecordPaymentDialog({
  contractId,
  contractIssuedOn,
  request,
  m,
  onAnswered,
  onAlreadyRecorded,
  onCheckPayments,
  onClose,
}: {
  contractId: string;
  /** The contract's issue day, `YYYY-MM-DD`: no payment is dated before it. */
  contractIssuedOn: string;
  request: { id: string; documentNumber: string; outstanding: string };
  m: (value: string) => string;
  /** Any answer, or none: the view it came with, else the tab reads itself. */
  onAnswered: (view?: ContractBillingView) => void;
  onAlreadyRecorded: () => void;
  /** Read the tab again; true when it was read. */
  onCheckPayments: () => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.record');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const locale = useLocale();
  const today = todayInCairo(new Date());
  const [typed, setTyped] = useState<TypedPayment>(() => ({
    amount: request.outstanding.replace(/\.?0+$/, ''),
    receivedOn: today,
    method: '',
    reference: '',
    note: '',
  }));
  const [previousAttempt, setPreviousAttempt] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: CONTRACT_PAYMENT_FIELDS, translate: withMoneyParams(te, locale) });
  const attempt = usePaymentAttempt(contractId, request.id);

  const box = (field: ContractPaymentField) => ({
    value: typed[field],
    onChange: (event: { target: { value: string } }) => setTyped((current) => ({ ...current, [field]: event.target.value })),
  });

  function send(idempotencyKey: string) {
    startTransition(async () => {
      try {
        const res = await recordContractPayment({ requestId: request.id, ...typed, idempotencyKey }, { contractId });
        attempt.settle(res);
        onAnswered(res.ok ? res.view : undefined);
        if (errors.applyResult(res)) return;
        if (res.already) onAlreadyRecorded();
        onClose();
      } catch (rejection) {
        attempt.settle('rejected');
        onAnswered();
        errors.applyRejection(rejection);
      }
    });
  }

  function submit() {
    if (errors.applyLocal(contractPaymentFieldErrors(typed, today, contractIssuedOn))) return;
    const read = readContractPayment(typed, today);
    if (!read.ok) return;
    const idempotencyKey = attempt.keyFor(paymentActOf(request.id, read.values));
    setCheckFailed(false);
    setPreviousAttempt(idempotencyKey === null);
    if (idempotencyKey !== null) send(idempotencyKey);
  }

  function checkPayments() {
    setCheckFailed(false);
    startTransition(async () => {
      if (!(await onCheckPayments())) {
        setCheckFailed(true);
        return;
      }
      // The studio now sees the ledger as it is: the next payment is a new act.
      attempt.forget();
      onClose();
    });
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('title', { request: request.documentNumber })}
      description={t('description')}
      onSubmit={submit}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError ?? (checkFailed ? t('checkFailed') : null)}
      invalidAttempt={errors.invalidAttempt}
    >
      {previousAttempt && (
        <div data-previous-attempt className="space-y-2 rounded-item border border-[color:var(--warn)] p-3" role="status">
          <p className="text-body">{t('previousAttempt')}</p>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={checkPayments}>
            {t('checkPayments')}
          </Button>
        </div>
      )}
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
        <Input type="date" dir="ltr" min={contractIssuedOn} max={today} {...box('receivedOn')} />
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
  );
}
