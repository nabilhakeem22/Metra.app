'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
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
  return <p className="py-3 text-sm text-muted-foreground">{text}</p>;
}

export function EngagementPanels({ tab, data }: { tab: EngagementTab; data: PanelData }) {
  return (
    <Card>
      <CardContent className="py-4">
        {tab === 'fee' && <FeePanel feeSchedule={data.feeSchedule} />}
        {tab === 'payments' && <PaymentsPanel payments={data.payments} />}
        {tab === 'artifacts' && <ArtifactsPanel artifacts={data.artifacts} />}
        {tab === 'changeOrders' && <ChangeOrdersPanel changeOrders={data.changeOrders} />}
        {tab === 'rom' && <RomPanel header={data.header} events={data.events} />}
        {tab === 'timeline' && (
          <TimelinePanel transitions={data.transitions} events={data.events} />
        )}
      </CardContent>
    </Card>
  );
}

function FeePanel({ feeSchedule }: { feeSchedule: EngagementFeeSchedule }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t('fee.designFee')}</span>
        <span dir="ltr">
          {feeSchedule.designFee ? formatMoney(feeSchedule.designFee, locale) : '—'}
        </span>
      </div>
      {feeSchedule.milestones.length === 0 ? (
        <Empty text={t('fee.notSet')} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-start font-medium">{t('fee.kind')}</th>
              <th className="py-2 text-start font-medium">{t('fee.basis')}</th>
              <th className="py-2 text-end font-medium">{t('fee.value')}</th>
            </tr>
          </thead>
          <tbody>
            {feeSchedule.milestones.map((m) => (
              <tr key={`${m.kind}-${m.sortOrder}`} className="border-b last:border-0">
                <td className="py-2">{t(`milestoneKind.${m.kind}`)}</td>
                <td className="py-2">{t(`milestoneBasis.${m.basis}`)}</td>
                <td className="py-2 text-end" dir="ltr">
                  {m.basis === 'amount' ? formatMoney(m.value, locale) : `${m.value}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-2 text-start font-medium">{t('payments.kind')}</th>
          <th className="py-2 text-end font-medium">{t('payments.amount')}</th>
          <th className="py-2 text-start font-medium">{t('payments.reference')}</th>
          <th className="py-2 text-start font-medium">{t('payments.clearedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id} className="border-b last:border-0">
            <td className="py-2">{t(`paymentKind.${p.kind}`)}</td>
            <td className="py-2 text-end" dir="ltr">
              {formatMoney(p.amount, locale)}
            </td>
            <td className="py-2 text-muted-foreground" dir="ltr">
              {p.reference || '—'}
            </td>
            <td className="py-2 text-muted-foreground" dir="ltr">
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
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-2 text-start font-medium">{t('artifacts.kind')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.label')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.attestedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {artifacts.map((a) => (
          <tr key={a.id} className="border-b last:border-0">
            <td className="py-2">{t(`artifactKind.${a.kind}`)}</td>
            <td className="py-2 text-muted-foreground">{a.label || '—'}</td>
            <td className="py-2 text-muted-foreground" dir="ltr">
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
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-2 text-end font-medium">{t('changeOrders.amount')}</th>
          <th className="py-2 text-start font-medium">{t('changeOrders.status')}</th>
          <th className="py-2 text-start font-medium">{t('changeOrders.raisedAt')}</th>
        </tr>
      </thead>
      <tbody>
        {changeOrders.map((c) => (
          <tr key={c.id} className="border-b last:border-0">
            <td className="py-2 text-end" dir="ltr">
              {formatMoney(c.amount, locale)}
            </td>
            <td className="py-2">{t(`changeOrderStatus.${c.status}`)}</td>
            <td className="py-2 text-muted-foreground" dir="ltr">
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
        <span className="text-muted-foreground">{t('rom.range')}</span>
        {hasRange ? (
          <span dir="ltr">
            {formatMoney(header.romLow, locale)} – {formatMoney(header.romHigh, locale)}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('rom.notSet')}</span>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('rom.acknowledgements')}
        </p>
        {acks.length === 0 ? (
          <Empty text={t('rom.noAcks')} />
        ) : (
          <ul className="space-y-1 text-sm">
            {acks.map((a) => (
              <li key={a.id} className="text-muted-foreground" dir="ltr">
                {formatDate(a.decidedAt, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TimelinePanel({
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
    <ul className="space-y-2 text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3">
          <span>{entry.label}</span>
          <span className="text-xs text-muted-foreground" dir="ltr">
            {formatDate(entry.at, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}
