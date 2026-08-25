'use client';

import { useLocale, useTranslations } from 'next-intl';
import type {
  EngagementArtifactRecord,
  EngagementChangeOrderRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import type { EngagementTab } from './tabs';

// Epic D, Slice 5 — the engagement detail panels, reskinned to the cockpit's
// right-rail look (scoped `.engagement-cockpit` palette, mono/tabular money). The
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
}

function Empty({ text }: { text: string }) {
  return <p className="py-3 text-sm text-[var(--ck-muted)]">{text}</p>;
}

const MONEY = 'text-end font-mono tabular-nums';
const HEAD_ROW = 'border-b border-[var(--ck-line)] text-xs text-[var(--ck-faint)]';

export function EngagementPanels({ tab, data }: { tab: EngagementTab; data: PanelData }) {
  return (
    <section className="engagement-cockpit rounded-[14px] border border-[var(--ck-line)] bg-[var(--ck-surface)] text-[var(--ck-ink)] shadow-sm">
      <div className="p-4">
        {tab === 'payments' && <PaymentsPanel payments={data.payments} />}
        {tab === 'artifacts' && <ArtifactsPanel artifacts={data.artifacts} />}
        {tab === 'changeOrders' && <ChangeOrdersPanel changeOrders={data.changeOrders} />}
        {tab === 'rom' && <RomPanel header={data.header} events={data.events} />}
      </div>
    </section>
  );
}

export function FeePanel({ feeSchedule }: { feeSchedule: EngagementFeeSchedule }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  return (
    <div className="text-[13px]">
      <div className="flex items-center justify-between border-b border-dashed border-[var(--ck-line)] py-2.5">
        <span className="text-[var(--ck-muted)]">{t('fee.designFee')}</span>
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
              className="flex items-center gap-2 border-b border-dashed border-[var(--ck-line)] py-2.5 last:border-0"
            >
              <span>{t(`milestoneKind.${m.kind}`)}</span>
              <span className="text-[11px] text-[var(--ck-faint)]">
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

function PaymentsPanel({ payments }: { payments: EngagementPayment[] }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (payments.length === 0) return <Empty text={t('payments.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-start font-medium">{t('payments.kind')}</th>
          <th className="py-2 text-end font-medium">{t('payments.amount')}</th>
          <th className="py-2 text-start font-medium">{t('payments.reference')}</th>
          <th className="py-2 text-start font-medium">{t('payments.clearedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id} className="border-b border-[var(--ck-line)] last:border-0">
            <td className="py-2">{t(`paymentKind.${p.kind}`)}</td>
            <td className={`py-2 ${MONEY}`} dir="ltr">
              {formatMoney(p.amount, locale)}
            </td>
            <td className="py-2 text-[var(--ck-muted)]" dir="ltr">
              {p.reference || '—'}
            </td>
            <td className="py-2 text-[var(--ck-muted)]" dir="ltr">
              {formatDate(p.clearedAt, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ArtifactsPanel({ artifacts }: { artifacts: EngagementArtifactRecord[] }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (artifacts.length === 0) return <Empty text={t('artifacts.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-start font-medium">{t('artifacts.kind')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.label')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.attestedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {artifacts.map((a) => (
          <tr key={a.id} className="border-b border-[var(--ck-line)] last:border-0">
            <td className="py-2">{t(`artifactKind.${a.kind}`)}</td>
            <td className="py-2 text-[var(--ck-muted)]">{a.label || '—'}</td>
            <td className="py-2 text-[var(--ck-muted)]" dir="ltr">
              {formatDate(a.attestedAt, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeOrdersPanel({
  changeOrders,
}: {
  changeOrders: EngagementChangeOrderRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (changeOrders.length === 0) return <Empty text={t('changeOrders.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-end font-medium">{t('changeOrders.amount')}</th>
          <th className="py-2 text-start font-medium">{t('changeOrders.status')}</th>
          <th className="py-2 text-start font-medium">{t('changeOrders.raisedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {changeOrders.map((c) => (
          <tr key={c.id} className="border-b border-[var(--ck-line)] last:border-0">
            <td className={`py-2 ${MONEY}`} dir="ltr">
              {formatMoney(c.amount, locale)}
            </td>
            <td className="py-2">{t(`changeOrderStatus.${c.status}`)}</td>
            <td className="py-2 text-[var(--ck-muted)]" dir="ltr">
              {formatDate(c.raisedAt, locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RomPanel({
  header,
  events,
}: {
  header: EngagementHeader;
  events: EngagementEventRecord[];
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const acks = events.filter((e) => e.kind === 'rom_acknowledgement');
  const hasRange = header.romLow !== null && header.romHigh !== null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--ck-muted)]">{t('rom.range')}</span>
        {hasRange ? (
          <span className="font-mono tabular-nums" dir="ltr">
            {formatMoney(header.romLow, locale)} – {formatMoney(header.romHigh, locale)}
          </span>
        ) : (
          <span className="text-[var(--ck-muted)]">{t('rom.notSet')}</span>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-[var(--ck-muted)]">
          {t('rom.acknowledgements')}
        </p>
        {acks.length === 0 ? (
          <Empty text={t('rom.noAcks')} />
        ) : (
          <ul className="space-y-1 text-sm">
            {acks.map((a) => (
              <li key={a.id} className="text-[var(--ck-muted)]" dir="ltr">
                {formatDate(a.decidedAt, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
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
            className="absolute top-1 inline-block h-2 w-2 rounded-full bg-[var(--ck-accent)]"
            style={{ insetInlineStart: '2px' }}
            aria-hidden
          />
          {index < entries.length - 1 && (
            <span
              className="absolute bottom-0 top-3 w-px bg-[var(--ck-line-strong)]"
              style={{ insetInlineStart: '5.5px' }}
              aria-hidden
            />
          )}
          <div className="font-medium">{entry.label}</div>
          <div className="font-mono text-[11px] text-[var(--ck-faint)]" dir="ltr">
            {formatDate(entry.at, locale)}
          </div>
        </li>
      ))}
    </ul>
  );
}
