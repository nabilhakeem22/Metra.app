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
import {
  isClientGenerated,
  isRecordedOnBehalf,
} from '@/lib/engagements/event-provenance';
import { formatDate } from '@/lib/format/date';
import { HandoffAckPanel } from './engagement-handoff-ack-panel';
import { PanelHeader } from './engagement-panel-header';
import { Empty } from './engagement-panels-parts';
import { RetractButton } from './engagement-retract-button';
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
 * The consequence is stated at the point of entry AND on the record afterwards:
 * a staff-recorded acknowledgement now carries a permanent marker, so nobody
 * reading this ledger later mistakes it for something the client typed. The two
 * dates and the evidence note have columns waiting for them (0043) and are not
 * captured yet — the form that writes them is the next piece.
 */
export function TimelineTab({
  engagementId,
  transitions,
  events,
  clientActivity,
  canRecordRomAck,
  canRecordHandoffAck,
  canRetract,
  romSet,
  pending,
  runAction,
}: {
  engagementId: string;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity: EngagementClientActivityRecord[];
  canRecordRomAck: boolean;
  canRecordHandoffAck: boolean;
  /** Owner/admin only — retracting a ledger row is not routine studio work. */
  canRetract: boolean;
  /** A build-cost band exists. Without one there is nothing to acknowledge. */
  romSet: boolean;
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

  // THE ONE GENUINE ELIGIBILITY CASE ON THIS PAGE. `recordRomAcknowledgementCore`
  // refuses with `rom_not_set` when no band exists -- you cannot acknowledge a
  // range nobody has entered. So the control stays on the page and says why,
  // rather than firing into a coded error the studio has to interpret. The
  // blocked state is the teaching moment: it names the act that unblocks it.
  const romAckBlocked = canRecordRomAck && !romSet;

  return (
    <div>
      <PanelHeader
        title={tp('timeline')}
        sub={tpa('timelineSub')}
        reason={romAckBlocked ? tpa('onBehalfBlocked') : undefined}
        actions={
          anyOnBehalf && (
            <>
              {canRecordRomAck && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-[color:var(--danger)] text-[color:var(--danger)] disabled:border-[color:var(--rule)] disabled:text-[color:var(--text-faint)]"
                  disabled={pending || romAckBlocked}
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
          engagementId={engagementId}
          transitions={transitions}
          events={events}
          clientActivity={clientActivity}
          canRetract={canRetract}
          pending={pending}
          runAction={runAction}
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
  engagementId,
  transitions,
  events,
  clientActivity = [],
  canRetract,
  pending,
  runAction,
}: {
  engagementId: string;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity?: EngagementClientActivityRecord[];
  canRetract: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();

  // Which rows a correction has retracted, and why. Read from the SAME array the
  // guards filter with `liveEvents` -- this view deliberately keeps the retracted
  // row visible (that history IS the protection) and marks it, rather than
  // hiding it as the guards do.
  const retractedBy = new Map(
    events
      .filter((e) => e.supersedesEventId !== null)
      .map((e) => [e.supersedesEventId as string, e]),
  );
  const entries = [
    ...transitions.map((tr) => ({
      id: `t-${tr.id}`,
      at: tr.decidedAt,
      onBehalf: false,
      label:
        tr.fromState && tr.toState
          ? t('timeline.arrow', {
              from: t(`state.${tr.fromState}`),
              to: t(`state.${tr.toState}`),
            })
          : t(`state.${tr.toState ?? 'created'}`),
      note: trimmedNote(tr.note),
      occurredOn: null,
      evidence: null,
      isCorrection: false,
      eventId: null as string | null,
      retraction: null as EngagementEventRecord | null,
    })),
    // CLIENT-CHANNEL ROWS ARE SKIPPED HERE, not filtered in the query: they
    // arrive again through `clientActivity` below, which carries the actor's
    // name. Rendering both drew every genuine client acknowledgement TWICE and
    // made this ledger unreliable to count -- which matters, because counting it
    // is what somebody does in a dispute.
    ...events
      .filter((e) => !isClientGenerated(e.actorChannel))
      .map((e) => ({
        id: `e-${e.id}`,
        at: e.decidedAt,
        label: t(`eventKind.${e.kind}`),
        note: trimmedNote(e.note),
        // The studio asserting somebody ELSE acted. The only row on this page
        // that needs saying out loud.
        onBehalf: isRecordedOnBehalf(e.kind, e.actorChannel),
        occurredOn: e.occurredOn,
        evidence: e.evidence,
        // The correction rows themselves are not entries -- they are rendered ON
        // the row they retract, below.
        isCorrection: e.supersedesEventId !== null,
        eventId: e.id,
        retraction: retractedBy.get(e.id) ?? null,
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
      onBehalf: false,
      occurredOn: null,
      evidence: null,
      isCorrection: false,
      eventId: null as string | null,
      retraction: null as EngagementEventRecord | null,
    })),
  ]
    // A correction is drawn ON the row it retracts, never as an entry of its own.
    .filter((e) => !e.isCorrection)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* A retracted row stays, struck through. Hiding it would defeat the
                point: the ledger is append-only precisely so a mistake and its
                withdrawal are BOTH on the record. The guards, unlike this view,
                stop counting it (`liveEvents`). */}
            <span
              className={`font-medium ${
                entry.retraction ? 'text-[color:var(--text-faint)] line-through' : ''
              }`}
            >
              {entry.label}
            </span>
            {/* PERMANENT, not a warning shown before the fact. A reader six
                months from now has to be able to tell this apart from something
                the client typed themselves -- the data layer always could, and
                until now this page could not. */}
            {entry.onBehalf && (
              <span className="inline-flex items-center rounded-[var(--r-pill)] border border-[color:var(--danger)] px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--danger)]">
                {t('timeline.onBehalfChip')}
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-[color:var(--text-faint)]" dir="ltr">
            {formatDate(entry.at, locale)}
          </div>
          {/* THE PROVENANCE BLOCK. What the chip asserts, spelled out: that the
              studio wrote this, when the client actually confirmed, and on what
              basis. It travels with the record, so somebody reading this months
              later has the whole claim in front of them rather than a colour.
              Rendered as PLAIN TEXT — React escapes it, so the free-text
              evidence field can never inject markup. */}
          {entry.retraction && (
            <div className="mt-1.5 border-s-2 border-[color:var(--danger)] ps-2 font-mono text-[11px] leading-relaxed">
              <span className="font-bold text-[color:var(--danger)]">
                {t('timeline.retracted')}
              </span>
              {entry.retraction.note && (
                <span className="ms-1.5 whitespace-pre-line break-words text-[color:var(--text-muted)]">
                  {entry.retraction.note}
                </span>
              )}
            </div>
          )}

          {canRetract && entry.eventId && !entry.retraction && (
            <div className="mt-1.5">
              <RetractButton
                engagementId={engagementId}
                eventId={entry.eventId}
                pending={pending}
                runAction={runAction}
              />
            </div>
          )}

          {entry.onBehalf && (
            <div className="mt-1.5 border-s-2 border-[color:var(--danger)] ps-2 font-mono text-[11px] leading-relaxed text-[color:var(--text-muted)]">
              <div className="font-bold text-[color:var(--danger)]">
                {t('timeline.recordedBy')}
              </div>
              {entry.occurredOn && (
                <div dir="ltr">
                  {t('timeline.confirmedOn', {
                    date: formatDate(entry.occurredOn, locale),
                  })}
                </div>
              )}
              {entry.evidence && (
                <div className="whitespace-pre-line break-words">
                  {entry.evidence}
                </div>
              )}
            </div>
          )}

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
