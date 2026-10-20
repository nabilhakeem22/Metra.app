'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { todayInCairo } from '@/lib/automation/clock';
import { issueMilestoneRequest, issueVariationRequest } from '@/lib/execution/requests/actions';
import { REQUEST_TERM_FIELDS, requestTermsFieldErrors, type RequestTermField } from '@/lib/execution/requests/input';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const sendRequestControlId = (field: RequestTermField) => `send-request-${field}`;

/** What the request bills: one schedule row, or one approved change order. */
export type RequestTarget = { kind: 'milestone' | 'variation'; id: string; label: string; amount: string };

/**
 * Send the payment request (مطالبة دفع) for one schedule row or one approved
 * change order: dated today, with an optional due day and note. It is frozen
 * once sent, so the dialog shows what it bills first. A schedule row larger
 * than what is left to bill is said, and still sendable (A4.1 addendum).
 */
export function SendRequestDialog({
  target,
  balance,
  m,
  onSent,
}: {
  target: RequestTarget;
  /** What is left to bill on the contract: a row above it is warned about. */
  balance: string;
  m: (value: string) => string;
  onSent: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.send');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [open, setOpen] = useState(false);
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: REQUEST_TERM_FIELDS, translate: te });
  const today = todayInCairo(new Date());
  const overBalance = target.kind === 'milestone' && parseMoney4(target.amount) > parseMoney4(balance);

  function submit() {
    if (errors.applyLocal(requestTermsFieldErrors({ dueOn, note }, today))) return;
    startTransition(async () => {
      try {
        const terms = { dueOn, note };
        const res =
          target.kind === 'milestone'
            ? await issueMilestoneRequest({ milestoneId: target.id, ...terms })
            : await issueVariationRequest({ variationOrderId: target.id, ...terms });
        if (errors.applyResult(res)) return;
        setOpen(false);
        onSent();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={t('title', { target: target.label })}
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
          {t('amount')} <span dir="ltr" className="font-mono tabular-nums">{m(target.amount)}</span>
        </p>
        {overBalance && (
          <p className="text-body text-[color:var(--warn)]">
            {t('overBalance')} <span dir="ltr" className="font-mono tabular-nums">{m(balance)}</span>
          </p>
        )}
        <FormField id={sendRequestControlId('dueOn')} label={t('dueOn')} {...errors.bind('dueOn')}>
          <Input type="date" dir="ltr" min={today} value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </FormField>
        <FormField id={sendRequestControlId('note')} label={t('note')} {...errors.bind('note')}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
      </FormSheet>
    </>
  );
}
