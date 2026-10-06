'use client';

import { Clock, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PaymentClaimState } from '@/lib/engagements/portal-payments';
import type { PaymentClaimSubmission } from './use-payment-claim';

/**
 * The "I've made this payment" control for ONE milestone, or its
 * waiting-for-confirmation note once a claim is open. `prominent` is the next
 * payment's full-width button; otherwise it is a small text button inside the
 * row, so no claimable milestone loses the capability. Renders nothing when the
 * SDF did not list the milestone as claimable.
 */
export function PaymentClaimControl({
  milestoneKind,
  claimState,
  submission,
  prominent,
}: {
  milestoneKind: string;
  claimState: PaymentClaimState;
  submission: PaymentClaimSubmission;
  prominent: boolean;
}) {
  const t = useTranslations('delivery.payments');
  if (claimState.kind === 'none') return null;

  if (claimState.kind === 'pending') {
    return (
      <p role="status" className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        {t('awaitingConfirmation')}
      </p>
    );
  }

  const submitting = submission.submittingKind === milestoneKind;
  const failure = submission.failure?.kind === milestoneKind ? submission.failure.error : null;
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={prominent ? 'outline' : 'ghost'}
        size={prominent ? 'default' : 'sm'}
        className={prominent ? 'w-full' : 'self-start'}
        disabled={submission.pending}
        onClick={() => submission.claim(milestoneKind)}
      >
        {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('claim')}
      </Button>
      {failure && (
        <p className="text-caption text-destructive" role="alert">
          {t(`error.${failure}`)}
        </p>
      )}
    </div>
  );
}
