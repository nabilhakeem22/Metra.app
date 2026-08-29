'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import type {
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
} from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import { EngagementPulseBar } from './engagement-pulse-bar';
import { Empty, MONEY } from './engagement-panels-parts';
import { PaymentsPanel } from './engagement-panels-payments';
import { RomPanel } from './engagement-panels-rom';

// The Payments detail tab — the whole commercial picture in one place: the
// commercial pulse (contract total · collected · pending gate), the fee schedule
// (audit ledger), the estimated build-cost range (ROM + acknowledgements) and the
// payment ledger. Pure composition over data the page already loaded; money is
// `font-mono tabular-nums`, `dir=ltr`. Logical CSS only so it mirrors in ar-EG RTL.
export function PaymentsTab({
  header,
  feeSchedule,
  payments,
  events,
  pulse,
}: {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  events: EngagementEventRecord[];
  pulse: CommercialPulse;
}) {
  const t = useTranslations('engagements');
  return (
    <div className="space-y-6">
      <EngagementPulseBar pulse={pulse} />

      <Section title={t('panels.fee')}>
        <FeeSchedule feeSchedule={feeSchedule} />
      </Section>

      <Section title={t('buildRangeLabel')}>
        <RomPanel header={header} events={events} />
      </Section>

      <Section title={t('panels.payments')}>
        <PaymentsPanel payments={payments} />
      </Section>
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
