'use client';

import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public';
import {
  derivePaymentsOverview,
  paymentClaimState,
  type PaymentRow,
} from '@/lib/engagements/portal-payments';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatMoney } from '@/lib/format/money';
import { NextPayment } from './next-payment';
import { PaymentClaimControl } from './payment-claim-control';
import { PaymentScheduleRow } from './payment-schedule-row';
import { useMilestoneLabel } from './use-milestone-label';
import { usePaymentClaim } from './use-payment-claim';

/** The all-paid close: a tick and a thank-you in place of the next payment. */
function SettledNote() {
  const t = useTranslations('delivery.payments');
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--success-tint)] text-[color:var(--success)]"
        aria-hidden
      >
        <Check className="size-4" />
      </span>
      <div>
        <p className="text-sm font-semibold">{t('settledTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('settledBody')}</p>
      </div>
    </div>
  );
}

/** The paid-so-far bar. A plain width: in RTL the bar fills from the right by itself. */
function PaidMeter({ percentPaid, label }: { percentPaid: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentPaid}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <span
        className="block h-full rounded-full bg-[color:var(--success)]"
        style={{ width: `${percentPaid}%` }}
      />
    </div>
  );
}

/**
 * The client's payments: the design fee, how much is paid, the ONE next payment
 * highlighted with its "I've made this payment" control, then every milestone with
 * its state. Other claimable milestones keep a small claim button in their row.
 * DUE amounts only (never cost); money is Latin digits, left-to-right; theme tokens
 * only, so it reads in light and dark. Renders nothing without a schedule.
 */
export function PaymentsCard({
  token,
  schedule,
  claim,
}: {
  token: string;
  schedule: PublicDelivery['paymentSchedule'];
  claim: PublicDelivery['paymentClaim'];
}) {
  const t = useTranslations('delivery.payments');
  const locale = useLocale();
  const milestoneLabel = useMilestoneLabel();
  const submission = usePaymentClaim(token);
  const overview = derivePaymentsOverview(schedule);
  if (!overview) return null;

  const money = (amount: string) => bidiIsolate(formatMoney(amount, locale));
  const claimControlFor = (row: PaymentRow, prominent: boolean) => (
    <PaymentClaimControl
      milestoneKind={row.milestoneKind}
      claimState={paymentClaimState(claim, row.milestoneKind, submission.claimedKinds)}
      submission={submission}
      prominent={prominent}
    />
  );
  const next = overview.next;
  const nextClaim = next ? paymentClaimState(claim, next.milestoneKind, submission.claimedKinds) : null;

  return (
    <section className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">{t('designFee', { amount: money(overview.total) })}</span>
      </div>
      <PaidMeter percentPaid={overview.percentPaid} label={t('title')} />
      {next ? (
        <>
          <p className="text-xs text-muted-foreground">
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
    </section>
  );
}
