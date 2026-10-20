'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { todayInCairo } from '@/lib/automation/clock';
import { issueFinalAccount } from '@/lib/execution/final-account/actions';
import type { FinalAccountView } from '@/lib/execution/final-account/load';
import { REQUEST_TERM_FIELDS, requestTermsFieldErrors, type RequestTermField } from '@/lib/execution/requests/input';
import { withMoneyParams } from './money-error-params';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const issueFinalAccountControlId = (field: RequestTermField) => `issue-final-account-${field}`;

/**
 * Issue the final account (الحساب الختامي) as the contract's last payment
 * request: dated today, with an optional due day and note, for the balance
 * the card shows (`expectedAmount`). The server recomputes it under the
 * contract lock; a balance that moved since (a reading, an approval, a request)
 * is refused with the new figure, said as money, and the card is read again so
 * the dialog then offers that figure. Every other refusal also re-reads the
 * card, and once it shows the account issued (by someone else) the dialog
 * closes on it.
 */
export function IssueFinalAccountDialog({
  contractId,
  amount,
  m,
  onAnswered,
  onClose,
}: {
  contractId: string;
  /** The balance the card shows now: what the request bills. */
  amount: string;
  m: (value: string) => string;
  /** Any answer: the view it came with, else the card reads itself; resolves to the view now shown. */
  onAnswered: (view?: FinalAccountView) => Promise<FinalAccountView | null>;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.finalAccount.issue');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: REQUEST_TERM_FIELDS, translate: withMoneyParams(te, locale) });
  const today = todayInCairo(new Date());

  function submit() {
    if (errors.applyLocal(requestTermsFieldErrors({ dueOn, note }, today))) return;
    startTransition(async () => {
      try {
        const res = await issueFinalAccount({ contractId, expectedAmount: amount, dueOn, note });
        if (res.ok) {
          await onAnswered(res.view);
          onClose();
          return;
        }
        const now = await onAnswered();
        if (now?.issued) return onClose();
        errors.applyResult(res);
      } catch (rejection) {
        const now = await onAnswered();
        if (now?.issued) return onClose();
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
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
      <p className="text-body">
        {t('amount')} <span dir="ltr" className="font-mono tabular-nums">{m(amount)}</span>
      </p>
      <FormField id={issueFinalAccountControlId('dueOn')} label={t('dueOn')} {...errors.bind('dueOn')}>
        <Input type="date" dir="ltr" min={today} value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
      </FormField>
      <FormField id={issueFinalAccountControlId('note')} label={t('note')} {...errors.bind('note')}>
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </FormField>
    </FormSheet>
  );
}
