'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import {
  awaitsPaymentNow,
  derivePaymentsOverview,
  paymentClaimState,
  type PaymentRow,
} from '@/lib/engagements/portal-payments';
import { bidiIsolate } from '@/lib/format/bidi';
import { NextPayment } from './next-payment';
import { PaymentClaimControl } from './payment-claim-control';
import { PaymentClaimDialog } from './payment-claim-dialog';
import { PaymentInstructions } from './payment-instructions';
import { PaymentReceipts } from './payment-receipts';
import { PaymentScheduleRow } from './payment-schedule-row';
import { PaidMeter, SettledNote } from './payments-summary';
import { formatPortalMoney } from './portal-money';
import { useMilestoneLabel } from './use-milestone-label';
import { usePaymentClaim } from './use-payment-claim';

/**
 * The client's payments: the design fee, how much is paid, the ONE next payment
 * highlighted with its "I've made this payment" control (which asks first, naming
 * the milestone and the amount), how to pay (the studio's own details, while a
 * payment is due and not yet claimed), then every milestone with its state, and
 * the payments received with their dates. Other claimable milestones keep a
 * small claim button in their row. DUE amounts only (never cost); money is Latin
 * digits, left-to-right; theme tokens only, so it reads in light and dark.
 * Renders nothing without a schedule.
 */
export function PaymentsCard({
  token,
  schedule,
  claim,
  details,
  timeline,
}: {
  token: string;
  schedule: PublicDelivery['paymentSchedule'];
  claim: PublicDelivery['paymentClaim'];
  details: PublicDelivery['paymentDetails'];
  timeline: PublicDelivery['timeline'];
}) {
  const t = useTranslations('delivery.payments');
  const locale = useLocale();
  const milestoneLabel = useMilestoneLabel();
  const submission = usePaymentClaim(token);
  const overview = derivePaymentsOverview(schedule);
  if (!overview) return null;

  const money = (amount: string) => bidiIsolate(formatPortalMoney(amount, locale));
  const claimStateOf = (milestoneKind: string) => paymentClaimState(claim, milestoneKind, submission.claimedKinds);
  const claimControlFor = (row: PaymentRow, prominent: boolean) => (
    <PaymentClaimControl
      milestoneKind={row.milestoneKind}
      claimState={claimStateOf(row.milestoneKind)}
      submission={submission}
      prominent={prominent}
    />
  );
  const next = overview.next;
  const nextClaim = next ? claimStateOf(next.milestoneKind) : null;
  // How to pay matters only while a payment that is DUE now (not a later one)
  // is still unclaimed; once every due payment is claimed, the claim's own
  // "we are confirming your payment" line is the answer (F11). The server
  // applies the same rule before it sends the details at all.
  const awaitsPayment = awaitsPaymentNow(schedule, claim, submission.claimedKinds);

  return (
    <section className="space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body font-semibold">{t('title')}</h2>
        <span className="text-caption text-muted-foreground">{t('designFee', { amount: money(overview.total) })}</span>
      </div>
      <PaidMeter percentPaid={overview.percentPaid} label={t('title')} />
      {submission.changedKind && (
        <p role="status" className="text-caption text-muted-foreground">
          {t('changed')}
        </p>
      )}
      {next ? (
        <>
          <p className="text-caption text-muted-foreground">
            {t('paidOf', { paid: money(overview.paid), total: money(overview.total) })}
          </p>
          <NextPayment
            label={milestoneLabel(next.milestoneKind)}
            amountRemaining={nextClaim?.kind === 'claimable' ? nextClaim.amountRemaining : next.amountRemaining}
            claimControl={claimControlFor(next, true)}
          />
        </>
      ) : (
        <SettledNote />
      )}
      {details && awaitsPayment && <PaymentInstructions details={details} />}
      <ul>
        {overview.rows.map((row) => (
          <PaymentScheduleRow
            key={row.milestoneKind}
            row={row}
            label={milestoneLabel(row.milestoneKind)}
            claimControl={row.isNext ? null : claimControlFor(row, false)}
          />
        ))}
      </ul>
      <PaymentReceipts timeline={timeline} />
      <PaymentClaimDialog claim={claim} submission={submission} milestoneLabel={milestoneLabel} />
    </section>
  );
}
