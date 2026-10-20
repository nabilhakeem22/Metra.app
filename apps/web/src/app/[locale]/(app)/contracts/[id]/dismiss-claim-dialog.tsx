'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormSheet } from '@/components/ui/form-sheet';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { dismissContractClaim } from '@/lib/execution/claims/actions';
import type { PendingClaimRow } from '@/lib/execution/claims/queries';

/**
 * A client's "I paid" whose money did not arrive (B4.2): the claim is closed
 * with no payment, and the client may say they paid again later. It has no
 * box, so a refusal (someone answered the claim meanwhile) is said above the
 * footer. Every answer re-reads the tab.
 */
export function DismissClaimDialog({
  contractId,
  claim,
  onAnswered,
  onClose,
}: {
  contractId: string;
  claim: PendingClaimRow;
  /** Any answer, or none: the view it came with, else the tab reads itself. */
  onAnswered: (view?: ContractBillingView) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.claims.dismiss');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setRefusal(null);
    startTransition(async () => {
      try {
        const res = await dismissContractClaim({ claimId: claim.id }, { contractId });
        onAnswered(res.ok ? res.view : undefined);
        if (!res.ok) return setRefusal(describeFailure(res, te));
        onClose();
      } catch (rejection) {
        onAnswered();
        setRefusal(describeRejection(rejection, te));
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
      formError={refusal}
    >
      {null}
    </FormSheet>
  );
}
