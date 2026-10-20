'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { confirmContractClaim } from '@/lib/execution/claims/actions';
import { CONFIRM_CLAIM_FIELDS, confirmClaimFieldErrors, type ConfirmClaimField } from '@/lib/execution/claims/input';
import type { PendingClaimRow } from '@/lib/execution/claims/queries';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';
import { withMoneyParams } from './money-error-params';

/** The DOM id of the dialog's box: its refusal sits under it. */
export const confirmClaimControlId = (field: ConfirmClaimField) => `confirm-claim-${field}`;

/**
 * The money of a client's "I paid" arrived (B4.2): the amount (opening on what
 * the client claimed, as studios type it, rewritten to the saved figure on
 * blur) is recorded as a payment on the request, dated today, and the claim is
 * closed, in one write. A figure past what is still due is refused under the
 * amount with that figure. A confirm is safe to send again (the claim answers
 * with its payment), so a lost answer only re-reads the tab; a refusal of the
 * claim itself (someone answered it meanwhile) is said above the footer.
 */
export function ConfirmClaimDialog({
  contractId,
  claim,
  onAnswered,
  onAlreadyConfirmed,
  onClose,
}: {
  contractId: string;
  claim: PendingClaimRow;
  /** Any answer, or none: the view it came with, else the tab reads itself. */
  onAnswered: (view?: ContractBillingView) => void;
  onAlreadyConfirmed: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.claims.confirm');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [amount, setAmount] = useState(() => claim.claimedAmount.replace(/\.?0+$/, ''));
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: CONFIRM_CLAIM_FIELDS, translate: withMoneyParams(te, locale) });

  function submit() {
    if (errors.applyLocal(confirmClaimFieldErrors({ amount }))) return;
    startTransition(async () => {
      try {
        const res = await confirmContractClaim({ claimId: claim.id, amount }, { contractId });
        onAnswered(res.ok ? res.view : undefined);
        if (errors.applyResult(res)) return;
        if (res.already) onAlreadyConfirmed();
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
      title={t('title', { request: claim.requestNumber })}
      description={t('description')}
      onSubmit={submit}
      submitLabel={t('submit')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <FormField id={confirmClaimControlId('amount')} label={t('amount')} required {...errors.bind('amount')}>
        <Input
          dir="ltr"
          inputMode="decimal"
          className="tabular-nums"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={(event) => setAmount(normalizeDecimalInput(event.target.value))}
        />
      </FormField>
    </FormSheet>
  );
}
