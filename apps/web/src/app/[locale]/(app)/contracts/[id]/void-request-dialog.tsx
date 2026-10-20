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

/** The DOM id of the dialog's box: its refusal sits under it. */
export const voidRequestControlId = (field: VoidRequestField) => `void-request-${field}`;

/**
 * Withdraw a mistaken payment request (plan A10), with the reason the audit
 * trail keeps. Offered on an unpaid request to the roles with
 * `invoices_issue`; a refusal of the request itself (a payment or a client
 * claim arrived meanwhile) is said above the footer. Every answer re-reads the
 * tab.
 */
export function VoidRequestDialog({
  contractId,
  request,
  onAnswered,
  onClose,
}: {
  contractId: string;
  request: { id: string; documentNumber: string };
  /** Any answer, or none: the view it came with, else the tab reads itself. */
  onAnswered: (view?: ContractBillingView) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.void');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: VOID_REQUEST_FIELDS, translate: te });

  function submit() {
    if (errors.applyLocal(voidReasonFieldErrors({ reason }))) return;
    startTransition(async () => {
      try {
        const res = await voidPaymentRequest({ requestId: request.id, reason }, { contractId });
        onAnswered(res.ok ? res.view : undefined);
        if (errors.applyResult(res)) return;
        onClose();
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
      title={t('title', { request: request.documentNumber })}
      description={t('description')}
      onSubmit={submit}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <FormField id={voidRequestControlId('reason')} label={t('reason')} required {...errors.bind('reason')}>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </FormField>
    </FormSheet>
  );
}
