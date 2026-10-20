'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { voidPaymentRequest } from '@/lib/execution/requests/actions';
import { VOID_REQUEST_FIELDS, voidReasonFieldErrors, type VoidRequestField } from '@/lib/execution/requests/input';

/** The DOM id of the dialog's box: its refusal sits under it. */
export const voidRequestControlId = (field: VoidRequestField) => `void-request-${field}`;

/**
 * Withdraw a mistaken payment request (plan A10), with the reason the audit
 * trail keeps. Offered on an unpaid request to the roles with
 * `invoices_issue`; a refusal of the request itself (a payment or a client
 * claim arrived meanwhile) is said above the footer.
 */
export function VoidRequestDialog({
  request,
  onVoided,
}: {
  request: { id: string; documentNumber: string };
  onVoided: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.void');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: VOID_REQUEST_FIELDS, translate: te });

  function submit() {
    if (errors.applyLocal(voidReasonFieldErrors({ reason }))) return;
    startTransition(async () => {
      try {
        const res = await voidPaymentRequest({ requestId: request.id, reason });
        if (errors.applyResult(res)) return;
        setOpen(false);
        onVoided();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
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
        formError={errors.formError}
        invalidAttempt={errors.invalidAttempt}
      >
        <FormField id={voidRequestControlId('reason')} label={t('reason')} required {...errors.bind('reason')}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </FormField>
      </FormSheet>
    </>
  );
}
