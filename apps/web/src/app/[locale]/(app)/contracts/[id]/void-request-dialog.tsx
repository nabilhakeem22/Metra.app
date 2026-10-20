'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { voidPaymentRequest } from '@/lib/execution/requests/actions';
import { VOID_REQUEST_FIELDS, voidReasonFieldErrors, type VoidRequestField } from '@/lib/execution/requests/input';
import { requestVoided } from './act-done';

/** The DOM id of the dialog's box: its refusal sits under it. */
export const voidRequestControlId = (field: VoidRequestField) => `void-request-${field}`;

/**
 * Withdraw a mistaken payment request (plan A10), with the reason the audit
 * trail keeps. Offered on an unpaid request to the roles with
 * `invoices_issue`; a refusal of the request itself (a payment or a client
 * claim arrived meanwhile) is said above the footer. Every answer re-reads the
 * tab; an answer that was lost, or `request_void`, is checked against that read,
 * and a request now void is said as voided, with one button that closes the
 * dialog, never as "try again" (A4 L2).
 */
export function VoidRequestDialog({
  contractId,
  request,
  onAnswered,
  onClose,
}: {
  contractId: string;
  request: { id: string; documentNumber: string };
  /** Any answer, or none: the view it came with, else the tab reads itself; resolves to the view now shown. */
  onAnswered: (view?: ContractBillingView) => Promise<ContractBillingView | null>;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.void');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [reason, setReason] = useState('');
  const [voided, setVoided] = useState(false);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: VOID_REQUEST_FIELDS, translate: te });

  function submit() {
    if (voided) return onClose();
    if (errors.applyLocal(voidReasonFieldErrors({ reason }))) return;
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof voidPaymentRequest>>;
      try {
        res = await voidPaymentRequest({ requestId: request.id, reason }, { contractId });
      } catch (rejection) {
        if (!(await voidedAfterAll())) errors.applyRejection(rejection);
        return;
      }
      if (!res.ok) {
        if (!(await voidedAfterAll())) errors.applyResult(res);
        return;
      }
      void onAnswered(res.view);
      onClose();
    });
  }

  /** After an answer that is not "voided": the tab read again; if the request is void now, say so (L2). */
  async function voidedAfterAll(): Promise<boolean> {
    const now = await onAnswered();
    if (!now || !requestVoided(request.id, now)) return false;
    errors.clear();
    setVoided(true);
    return true;
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('title', { request: request.documentNumber })}
      description={t('description')}
      onSubmit={submit}
      submitLabel={voided ? tc('close') : t('submit')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      {voided ? (
        <p className="text-body font-medium" role="status">
          {t('done')}
        </p>
      ) : (
        <FormField id={voidRequestControlId('reason')} label={t('reason')} required {...errors.bind('reason')}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </FormField>
      )}
    </FormSheet>
  );
}
