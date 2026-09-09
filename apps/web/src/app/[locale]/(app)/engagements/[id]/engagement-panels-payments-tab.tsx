'use client';

import { Banknote } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import type {
  EngagementFeeSchedule,
  EngagementPayment,
} from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import { PanelHeader } from './engagement-panel-header';
import { Empty, MONEY } from './engagement-panels-parts';
import { PaymentsPanel } from './engagement-panels-payments';
import { PaymentPanel } from './engagement-payment-panel';
import { EngagementPulseBar } from './engagement-pulse-bar';

/**
 * The Payments detail tab — the commercial pulse, the fee schedule and the
 * payment ledger. The design fee, and the milestones it is collected against.
 *
 * ONE action sits in the header: log a payment. The build-cost range does NOT
 * belong here and no longer lives here — it moved to its own Budget tab, taking
 * its action with it. Filing the indicative BUILD cost beside the design FEE
 * would re-merge in the interface two things the schema separates on purpose,
 * and it also flattened a versioned, acknowledged, eventually-superseded record
 * into a single number in someone else's ledger.
 */
export function PaymentsTab({
  engagementId,
  feeSchedule,
  payments,
  pulse,
  canRecordPayment,
  pending,
  runAction,
}: {
  engagementId: string;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  pulse: CommercialPulse;
  canRecordPayment: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  const [payOpen, setPayOpen] = useState(false);

  return (
    <div>
      <PanelHeader
        title={tp('payments')}
        sub={tpa('paymentsSub')}
        actions={
          canRecordPayment && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => setPayOpen((open) => !open)}
              aria-expanded={payOpen}
            >
              <Banknote className="size-4" aria-hidden />
              {tpa('logPayment')}
            </Button>
          )
        }
      />
      <div className="space-y-6 p-4">
        {payOpen && (
          <PaymentPanel
            engagementId={engagementId}
            pending={pending}
            runAction={runAction}
            onDone={() => setPayOpen(false)}
          />
        )}

        <EngagementPulseBar pulse={pulse} />

        <Section title={tp('fee')}>
          <FeeSchedule feeSchedule={feeSchedule} />
        </Section>

        <Section title={tp('payments')}>
          <PaymentsPanel payments={payments} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
        {title}
      </p>
      {children}
    </div>
  );
}

function FeeSchedule({ feeSchedule }: { feeSchedule: EngagementFeeSchedule }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  return (
    <div className="text-[13px]">
      <div className="flex items-center justify-between border-b border-dashed border-[color:var(--rule)] py-2.5">
        <span className="text-[color:var(--text-muted)]">{t('fee.designFee')}</span>
        <span className={MONEY} dir="ltr">
          {feeSchedule.designFee ? formatMoney(feeSchedule.designFee, locale) : '—'}
        </span>
      </div>
      {feeSchedule.milestones.length === 0 ? (
        <Empty text={t('fee.notSet')} />
      ) : (
        <ul className="m-0 list-none p-0">
          {feeSchedule.milestones.map((m) => (
            <li
              key={`${m.kind}-${m.sortOrder}`}
              className="flex items-center gap-2 border-b border-dashed border-[color:var(--rule)] py-2.5 last:border-0"
            >
              <span>{t(`milestoneKind.${m.kind}`)}</span>
              <span className="text-[11px] text-[color:var(--text-faint)]">
                {t(`milestoneBasis.${m.basis}`)}
              </span>
              <span className={`ms-auto ${MONEY}`} dir="ltr">
                {m.basis === 'amount' ? formatMoney(m.value, locale) : `${m.value}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
