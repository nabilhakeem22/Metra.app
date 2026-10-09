'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import { paymentClaimState } from '@/lib/engagements/portal-payments';
import { bidiIsolate } from '@/lib/format/bidi';
import { ConfirmActDialog } from './confirm-act-dialog';
import { formatPortalMoney } from './portal-money';
import type { PaymentClaimSubmission } from './use-payment-claim';

/**
 * "Did you make this payment?" before a claim is sent: it names the milestone
 * and the amount the claim records (the server-locked remaining), so the
 * client confirms the figure, not just the button. Cancel sends nothing.
 */
export function PaymentClaimDialog({
  claim,
  submission,
  milestoneLabel,
}: {
  claim: PublicDelivery['paymentClaim'];
  submission: PaymentClaimSubmission;
  milestoneLabel: (milestoneKind: string) => string;
}) {
  const t = useTranslations('delivery.payments');
  const tActions = useTranslations('delivery.actions');
  const locale = useLocale();
  const kind = submission.askingKind;
  const state = kind ? paymentClaimState(claim, kind, submission.claimedKinds) : null;
  const amount = state?.kind === 'claimable' ? state.amountRemaining : null;

  return (
    <ConfirmActDialog
      open={kind !== null && amount !== null}
      title={t('confirmTitle')}
      body={
        <p>
          {t('confirmBody', {
            milestone: kind ? milestoneLabel(kind) : '',
            amount: amount ? bidiIsolate(formatPortalMoney(amount, locale)) : '',
          })}
        </p>
      }
      confirmLabel={tActions('confirm')}
      cancelLabel={tActions('cancel')}
      pending={submission.pending}
      onConfirm={submission.confirm}
      onOpenChange={(open) => !open && submission.dismiss()}
    />
  );
}
