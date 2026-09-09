'use client';

import { UserCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type {
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { HandoffAckPanel } from './engagement-handoff-ack-panel';
import { PanelHeader } from './engagement-panel-header';
import { Empty } from './engagement-panels-parts';
import { RomAckPanel } from './engagement-rom-ack-panel';

type OnBehalfPanel = 'rom' | 'handoff';

/**
 * The Timeline detail tab — transitions, events and the client-activity feed in
 * one record, newest first.
 *
 * It is also the home of the ONE action in this cockpit that asserts somebody
 * else acted: recording a client acknowledgement the studio took offline. It
 * belongs here because this is the record it writes into, and it is drawn as a
 * warning rather than as a peer of "attach a drawing" — which is exactly what it
 * looked like in the old strip, one identical tile among four.
 *
 * The consequence is stated at the point of entry. Making it stick to the RECORD
 * afterwards — who acknowledged, who typed it, on what evidence, and on which of
 * the two relevant dates — is a schema change and is not in this slice.
 */
export function TimelineTab({
  engagementId,
  transitions,
  events,
  clientActivity,
  canRecordRomAck,
  canRecordHandoffAck,
  pending,
  runAction,
}: {
  engagementId: string;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity: EngagementClientActivityRecord[];
  canRecordRomAck: boolean;
  canRecordHandoffAck: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  const tha = useTranslations('engagements.handoffAck');
  const [panel, setPanel] = useState<OnBehalfPanel | null>(null);

  function toggle(next: OnBehalfPanel) {
    setPanel((open) => (open === next ? null : next));
  }

  const anyOnBehalf = canRecordRomAck || canRecordHandoffAck;

  return (
    <div>
      <PanelHeader
        title={tp('timeline')}
        sub={tpa('timelineSub')}
        actions={
          anyOnBehalf && (
            <>
              {canRecordRomAck && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-[color:var(--danger)] text-[color:var(--danger)]"
                  disabled={pending}
                  onClick={() => toggle('rom')}
                  aria-expanded={panel === 'rom'}
                >
                  <UserCheck className="size-4" aria-hidden />
                  {tpa('onBehalf')}
                </Button>
              )}
              {canRecordHandoffAck && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-[color:var(--danger)] text-[color:var(--danger)]"
                  disabled={pending}
                  onClick={() => toggle('handoff')}
                  aria-expanded={panel === 'handoff'}
                >
                  <UserCheck className="size-4" aria-hidden />
                  {tha('title')}
                </Button>
              )}
            </>
          )
        }
      />
      <div className="p-4">
        {panel !== null && (
          <div className="mb-4 space-y-2.5 rounded-[var(--r-item)] border border-[color:var(--danger)] p-3.5">
            {/* Stated where the decision is made, not in a tooltip: this logs an
                acknowledgement AS the client, and the studio should read that
                sentence before the fields, every time. */}
            <p className="text-[12.5px] text-[color:var(--text)]">
              {tpa('onBehalfNote')}
            </p>
            {panel === 'rom' ? (
              <RomAckPanel
                engagementId={engagementId}
                pending={pending}
                runAction={runAction}
                onDone={() => setPanel(null)}
              />
            ) : (
              <HandoffAckPanel
                engagementId={engagementId}
                pending={pending}
                runAction={runAction}
                onDone={() => setPanel(null)}
              />
            )}
          </div>
        )}
        <TimelineFeed
          transitions={transitions}
          events={events}
          clientActivity={clientActivity}
        />
      </div>
    </div>
  );
}

/**
 * A ledger row's free-text note, blank-safe: whitespace-only (or absent) reads as
 * "no note" so the timeline never renders an empty quoted line.
 */
function trimmedNote(note: string | null): string | null {
  return note?.trim() || null;
}

function TimelineFeed({
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
        <li key={entry.id} className="relative ps-5 pb-3.5 text-[12.5px] last:pb-0">
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
