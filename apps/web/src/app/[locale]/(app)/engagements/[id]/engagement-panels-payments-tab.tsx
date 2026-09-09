'use client';

import { Banknote, Ruler } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import type {
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
} from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import { PanelHeader } from './engagement-panel-header';
import { Empty, MONEY } from './engagement-panels-parts';
import { PaymentsPanel } from './engagement-panels-payments';
import { RomPanel } from './engagement-panels-rom';
import { PaymentPanel } from './engagement-payment-panel';
import { EngagementPulseBar } from './engagement-pulse-bar';
import { RomRangeForm } from './engagement-rom-range-form';

/**
 * The Payments detail tab — the commercial pulse, the fee schedule, the
 * build-cost range and the payment ledger.
 *
 * ONE action sits in the header: log a payment. That is deliberate and it is the
 * whole reason this tab was reworked. The obvious place to put "set the budget
 * range" was right beside it — and that would have filed the indicative BUILD
 * cost next to the design FEE, re-merging in the interface two things the schema
 * separates on purpose. So the range keeps its own action, in its own section,
 * next to the number it writes. When the build-cost surface earns its own tab it
 * takes that section with it, and this header does not change.
 */
export function PaymentsTab({
  engagementId,
  header,
  feeSchedule,
  payments,
  events,
  pulse,
  canRecordPayment,
  canSetRom,
  pending,
  runAction,
}: {
  engagementId: string;
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  events: EngagementEventRecord[];
  pulse: CommercialPulse;
  canRecordPayment: boolean;
  canSetRom: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  const [payOpen, setPayOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const hasRange = header.romLow !== null && header.romHigh !== null;

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

        <Section
          title={t('buildRangeLabel')}
          note={tpa('rangeNote')}
          action={
            canSetRom && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setRangeOpen((open) => !open)}
                aria-expanded={rangeOpen}
              >
                <Ruler className="size-4" aria-hidden />
                {hasRange ? tpa('reviseRange') : tpa('setRange')}
              </Button>
            )
          }
        >
          {rangeOpen && (
            <div className="mb-3">
              <RomRangeForm
                engagementId={engagementId}
                pending={pending}
                runAction={runAction}
                onDone={() => setRangeOpen(false)}
              />
            </div>
          )}
          <RomPanel header={header} events={events} />
        </Section>

        <Section title={tp('payments')}>
          <PaymentsPanel payments={payments} />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  /** One quiet line under the label — what this section IS, when that is not obvious. */
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
            {title}
          </p>
          {note && (
            <p className="mt-0.5 text-[12px] text-[color:var(--text-faint)]">{note}</p>
          )}
        </div>
        {action && <div style={{ marginInlineStart: 'auto' }}>{action}</div>}
      </div>
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
