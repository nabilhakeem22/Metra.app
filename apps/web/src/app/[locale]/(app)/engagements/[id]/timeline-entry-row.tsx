'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ActionResult } from '@/lib/actions/result';
import { formatDate } from '@/lib/format/date';
import { RetractButton } from './engagement-retract-button';
import type { TimelineEntry } from './timeline-entries';

const PROVENANCE_BLOCK =
  'mt-1.5 border-s-2 border-[color:var(--danger)] ps-2 text-caption leading-relaxed ltr:font-mono';

/**
 * THE PROVENANCE BLOCK. What the on-behalf chip asserts, spelled out: that the
 * studio wrote this, when the client actually confirmed, and on what basis. It
 * travels with the record, so somebody reading this months later has the whole
 * claim in front of them rather than a colour. Rendered as PLAIN TEXT — React
 * escapes it, so the free-text evidence field can never inject markup.
 */
function OnBehalfProvenance({ entry }: { entry: TimelineEntry }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  return (
    <div className={`${PROVENANCE_BLOCK} text-[color:var(--text-muted)]`}>
      <div className="font-bold text-[color:var(--danger)]">{t('timeline.recordedBy')}</div>
      {entry.occurredOn && (
        <div dir="ltr">
          {t('timeline.confirmedOn', { date: formatDate(entry.occurredOn, locale) })}
        </div>
      )}
      {entry.evidence && (
        <div className="whitespace-pre-line break-words">{entry.evidence}</div>
      )}
    </div>
  );
}

export function TimelineEntryRow({
  entry,
  isLast,
  engagementId,
  canRetract,
  pending,
  runAction,
}: {
  entry: TimelineEntry;
  isLast: boolean;
  engagementId: string;
  canRetract: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  return (
    <li className="relative ps-5 pb-3.5 text-small last:pb-0">
      <span
        className="absolute top-1 inline-block h-2 w-2 rounded-full bg-brand"
        style={{ insetInlineStart: '2px' }}
        aria-hidden
      />
      {!isLast && (
        <span
          className="absolute bottom-0 top-3 w-px bg-[color:var(--rule)]"
          style={{ insetInlineStart: '5.5px' }}
          aria-hidden
        />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* A retracted row stays, struck through. Hiding it would defeat the
            point: the ledger is append-only precisely so a mistake and its
            withdrawal are BOTH on the record. The guards, unlike this view, stop
            counting it (`liveEvents`). */}
        <span
          className={`font-medium ${entry.retraction ? 'text-[color:var(--text-faint)] line-through' : ''}`}
        >
          {entry.label}
        </span>
        {/* PERMANENT, not a warning shown before the fact. A reader six months
            from now has to be able to tell this apart from something the client
            typed themselves -- the data layer always could, and until now this
            page could not. */}
        {entry.onBehalf && (
          <span className="inline-flex items-center rounded-pill border border-[color:var(--danger)] px-2 py-0.5 text-caption font-bold text-[color:var(--danger)] ltr:font-mono ltr:uppercase ltr:tracking-[0.06em]">
            {t('timeline.onBehalfChip')}
          </span>
        )}
      </div>
      <div className="font-mono text-caption text-[color:var(--text-faint)]" dir="ltr">
        {formatDate(entry.at, locale)}
      </div>

      {entry.retraction && (
        <div className={PROVENANCE_BLOCK}>
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

      {entry.onBehalf && <OnBehalfProvenance entry={entry} />}

      {/* The author's own words (the client's change-request text, a staff note)
          — quoted, secondary, and rendered as PLAIN TEXT: React escapes it, so
          user-authored input can never inject markup here. */}
      {entry.note && (
        <p className="mt-1 whitespace-pre-line break-words border-s-2 border-[color:var(--rule)] ps-2 text-caption text-[color:var(--text-muted)]">
          {t('noteQuote', { note: entry.note })}
        </p>
      )}
    </li>
  );
}
