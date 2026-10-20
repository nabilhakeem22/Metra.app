'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { todayInCairo } from '@/lib/automation/clock';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { issueMilestoneRequest, issueVariationRequest } from '@/lib/execution/requests/actions';
import { REQUEST_TERM_FIELDS, requestTermsFieldErrors, type RequestTermField } from '@/lib/execution/requests/input';
import { balanceFit, type BalanceFit } from './billing-balance';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const sendRequestControlId = (field: RequestTermField) => `send-request-${field}`;

/** What the request bills: one schedule row, or one approved change order. */
export type RequestTarget = { kind: 'milestone' | 'variation'; id: string; label: string; amount: string };

/** What the server said about the balance of a request it SENT (issue-milestone.ts `balanceWarning`). */
type SentPastBalance = { fit: BalanceFit; balance: string };

/** Send the target's request; a schedule row's answer may carry the server's balance warning. */
async function sendRequest(target: RequestTarget, terms: { dueOn: string; note: string }, contractId: string) {
  const tab = { contractId };
  if (target.kind === 'variation') return issueVariationRequest({ variationOrderId: target.id, ...terms }, tab);
  return issueMilestoneRequest({ milestoneId: target.id, ...terms }, tab);
}

/** A schedule row past what is left to bill: before sending (it can still be sent), or once sent. */
function BalanceNote({ fit, balance, sent, m }: { fit: BalanceFit; balance: string; sent: boolean; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.payments.send');
  if (fit === 'within') return null;
  const figure = fit === 'over' && <span dir="ltr" className="font-mono tabular-nums">{m(balance)}</span>;
  const key = fit === 'over' ? (sent ? 'sentOverBalance' : 'overBalance') : sent ? 'sentCovered' : 'alreadyCovered';
  return (
    <p className="text-body text-[color:var(--warn)]">
      {t(key)} {figure}
    </p>
  );
}

/**
 * Send the payment request (مطالبة دفع) for one schedule row or one approved
 * change order: dated today, with an optional due day and note. It is frozen
 * once sent, so the dialog shows what it bills first. A schedule row larger
 * than what is left to bill is said, from the view the tab has just read, and
 * still sendable (A4.1 addendum). The SERVER decides that under the contract
 * lock: when it answers that the sent request went past the balance
 * (`balanceWarning`), the dialog stays open to say so (A4 F3), and its button
 * only closes it. Every answer re-reads the tab.
 */
export function SendRequestDialog({
  contractId,
  target,
  balance,
  m,
  onAnswered,
  onClose,
}: {
  contractId: string;
  target: RequestTarget;
  /** What is left to bill on the contract: a row above it is warned about. */
  balance: string;
  m: (value: string) => string;
  /** Any answer, or none: the view it came with, else the tab reads itself. */
  onAnswered: (view?: ContractBillingView) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.send');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<SentPastBalance | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: REQUEST_TERM_FIELDS, translate: te });
  const today = todayInCairo(new Date());
  const fit = target.kind === 'milestone' ? balanceFit(target.amount, balance) : 'within';

  function submit() {
    if (sent) return onClose();
    if (errors.applyLocal(requestTermsFieldErrors({ dueOn, note }, today))) return;
    startTransition(async () => {
      try {
        const res: Awaited<ReturnType<typeof issueMilestoneRequest>> = await sendRequest(target, { dueOn, note }, contractId);
        onAnswered(res.ok ? res.view : undefined);
        if (errors.applyResult(res)) return;
        const warning = res.balanceWarning;
        if (warning) setSent({ fit: balanceFit(target.amount, warning.balance), balance: warning.balance });
        else onClose();
      } catch (rejection) {
        onAnswered();
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('title', { target: target.label })}
      description={t('description')}
      onSubmit={submit}
      submitLabel={sent ? tc('close') : t('submit')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <p className="text-body">
        {t('amount')} <span dir="ltr" className="font-mono tabular-nums">{m(target.amount)}</span>
      </p>
      {sent ? (
        <div role="status" className="space-y-2">
          <p className="text-body font-medium">{t('sent')}</p>
          <BalanceNote fit={sent.fit} balance={sent.balance} sent m={m} />
        </div>
      ) : (
        <>
          <BalanceNote fit={fit} balance={balance} sent={false} m={m} />
          <FormField id={sendRequestControlId('dueOn')} label={t('dueOn')} {...errors.bind('dueOn')}>
            <Input type="date" dir="ltr" min={today} value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </FormField>
          <FormField id={sendRequestControlId('note')} label={t('note')} {...errors.bind('note')}>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
        </>
      )}
    </FormSheet>
  );
}
