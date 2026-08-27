'use client';

import { useLocale, useTranslations } from 'next-intl';
import type {
  EngagementArtifactRecord,
  EngagementChangeOrderRecord,
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { ArtifactsPanel } from './engagement-panels-artifacts';
import { ChangeOrdersPanel } from './engagement-panels-change-orders';
import { ClientActivityPanel } from './engagement-client-activity-panel';
import { Empty, MONEY } from './engagement-panels-parts';
import { PaymentsPanel } from './engagement-panels-payments';
import { RomPanel } from './engagement-panels-rom';
import type { EngagementTab } from './tabs';

// Epic D, Slice 5 — the engagement detail panels, reskinned to the glass system as
// a FLAT (opaque `bg-card`, no backdrop-filter) panel with mono/tabular money. The
// fee schedule (audit ledger) and the recent-activity timeline are now PINNED in
// the right rail (see engagement-right-rail.tsx) — `FeePanel` and `TimelinePanel`
// are exported for that reuse. This tabbed surface keeps the fuller detail
// (payments · artifacts · change orders · build-cost range). Visual reskin only —
// no data or query change. Logical CSS only so it mirrors in ar-EG RTL; money is
// `font-mono tabular-nums`, `dir=ltr`.

export interface PanelData {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  clientActivity: EngagementClientActivityRecord[];
}

export function EngagementPanels({ tab, data }: { tab: EngagementTab; data: PanelData }) {
  return (
    <section className="rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      <div className="p-4">
        {tab === 'payments' && <PaymentsPanel payments={data.payments} />}
        {tab === 'artifacts' && <ArtifactsPanel artifacts={data.artifacts} />}
        {tab === 'changeOrders' && <ChangeOrdersPanel changeOrders={data.changeOrders} />}
        {tab === 'rom' && <RomPanel header={data.header} events={data.events} />}
        {tab === 'clientActivity' && (
          <ClientActivityPanel activity={data.clientActivity} />
        )}
      </div>
    </section>
  );
}

export function FeePanel({ feeSchedule }: { feeSchedule: EngagementFeeSchedule }) {
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

export function TimelinePanel({
  transitions,
  events,
}: {
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const entries = [
    ...transitions.map((tr) => ({
      id: `t-${tr.id}`,
      at: tr.decidedAt,
      label:
        tr.fromState && tr.toState
          ? t('timeline.arrow', {
              from: t(`state.${tr.fromState}`),
              to: t(`state.${tr.toState}`),
            })
          : t(`state.${tr.toState ?? 'created'}`),
    })),
    ...events.map((e) => ({
      id: `e-${e.id}`,
      at: e.decidedAt,
      label: t(`eventKind.${e.kind}`),
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (entries.length === 0) return <Empty text={t('timeline.empty')} />;
  return (
    <ul className="m-0 list-none p-0">
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          className="relative ps-5 pb-3.5 text-[12.5px] last:pb-0"
        >
          <span
            className="absolute top-1 inline-block h-2 w-2 rounded-full bg-brand"
            style={{ insetInlineStart: '2px' }}
            aria-hidden
          />
          {index < entries.length - 1 && (
            <span
              className="absolute bottom-0 top-3 w-px bg-[color:var(--rule)]"
              style={{ insetInlineStart: '5.5px' }}
              aria-hidden
            />
          )}
          <div className="font-medium">{entry.label}</div>
          <div className="font-mono text-[11px] text-[color:var(--text-faint)]" dir="ltr">
            {formatDate(entry.at, locale)}
          </div>
        </li>
      ))}
    </ul>
  );
}
