'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CommercialPulse } from '@/lib/engagements/pulse';
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
import { ChangeOrdersPanel } from './engagement-panels-change-orders';
import { Empty } from './engagement-panels-parts';
import { PaymentsTab } from './engagement-panels-payments-tab';
import { FilesTab } from './engagement-panels-files';
import type { EngagementTab } from './tabs';

// The engagement detail panels — the fuller record below the command card,
// dispatched by the four detail tabs. Files (working-files tray + the full
// artifact list), Timeline (transitions + events + the client-activity feed),
// Payments (the commercial pulse + fee schedule + build-cost range + the payment
// ledger) and Change orders. Visual reskin of the glass system as a FLAT (opaque
// `bg-card`) surface; money is `font-mono tabular-nums`, `dir=ltr`. Logical CSS
// only so it mirrors in ar-EG RTL.

export interface PanelData {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  clientActivity: EngagementClientActivityRecord[];
  pulse: CommercialPulse;
}

export function EngagementPanels({
  tab,
  data,
  engagementId,
  canUpload,
}: {
  tab: EngagementTab;
  data: PanelData;
  engagementId: string;
  canUpload: boolean;
}) {
  return (
    <section className="rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      <div className="p-4">
        {tab === 'files' && (
          <FilesTab
            engagementId={engagementId}
            artifacts={data.artifacts}
            canUpload={canUpload}
          />
        )}
        {tab === 'timeline' && (
          <TimelinePanel
            transitions={data.transitions}
            events={data.events}
            clientActivity={data.clientActivity}
          />
        )}
        {tab === 'payments' && (
          <PaymentsTab
            header={data.header}
            feeSchedule={data.feeSchedule}
            payments={data.payments}
            events={data.events}
            pulse={data.pulse}
          />
        )}
        {tab === 'changeOrders' && (
          <ChangeOrdersPanel changeOrders={data.changeOrders} />
        )}
      </div>
    </section>
  );
}

/**
 * A ledger row's free-text note, blank-safe: whitespace-only (or absent) reads as
 * "no note" so the timeline never renders an empty quoted line.
 */
function trimmedNote(note: string | null): string | null {
  return note?.trim() || null;
}

export function TimelinePanel({
  transitions,
  events,
  clientActivity = [],
}: {
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity?: EngagementClientActivityRecord[];
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
      note: trimmedNote(tr.note),
    })),
    ...events.map((e) => ({
      id: `e-${e.id}`,
      at: e.decidedAt,
      label: t(`eventKind.${e.kind}`),
      note: trimmedNote(e.note),
    })),
    // The client-activity feed (approvals + change requests from the client's
    // link) merges into the one timeline, newest-first with everything else.
    ...clientActivity.map((entry, index) => ({
      id: `c-${entry.kind}-${index}`,
      at: entry.decidedAt,
      label: entry.actorName
        ? `${t(`eventKind.${entry.kind}`)} · ${t('clientActivity.by', { name: entry.actorName })}`
        : t(`eventKind.${entry.kind}`),
      note: trimmedNote(entry.note),
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
          {/* The author's own words (the client's change-request text, a staff
              note) — quoted, secondary, and rendered as PLAIN TEXT: React escapes
              it, so user-authored input can never inject markup here. */}
          {entry.note && (
            <p className="mt-1 whitespace-pre-line break-words border-s-2 border-[color:var(--rule)] ps-2 text-[12px] text-[color:var(--text-muted)]">
              {t('noteQuote', { note: entry.note })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
