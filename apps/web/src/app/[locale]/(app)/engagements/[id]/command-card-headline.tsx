'use client';

import { useLocale, useTranslations } from 'next-intl';
import { findLatestClientChangeRequestNote } from '@/lib/engagements/client-activity-note';
import type { EngagementClientActivityRecord } from '@/lib/engagements/queries/client-activity';
import { formatDate } from '@/lib/format/date';
import type { CommandCardCopy } from './command-card-copy';

/**
 * The client's own words — a QUIET callout under the headline, never a second CTA.
 * Plain text: React escapes it, so client-authored input can never inject markup.
 * Logical CSS only, so it mirrors in ar-EG.
 */
function ClientNoteCallout({
  clientActivity,
}: {
  clientActivity: EngagementClientActivityRecord[];
}) {
  const t = useTranslations('engagements');
  const tcmd = useTranslations('engagements.command');
  const locale = useLocale();
  // The brief for the revision the studio is about to make. It belongs next to
  // the headline, not buried in the timeline tab. Null when the client has asked
  // for nothing (or asked with no words), and never an approval's note.
  const clientNote = findLatestClientChangeRequestNote(clientActivity);
  if (!clientNote) return null;
  const clientNoteDate = formatDate(clientNote.decidedAt, locale);
  return (
    <div className="mb-4 rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-[color:var(--track)] px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-faint)]">
        {tcmd('clientNote')}
      </p>
      {/* Clamped to 4 lines: a long client note must never push the primary
          Advance CTA below the fold — the whole point of this card is one
          unmissable next action. The full text is always in the Timeline. */}
      <p className="mt-1 line-clamp-4 whitespace-pre-line break-words text-[13.5px] text-[color:var(--text)]">
        {t('noteQuote', { note: clientNote.note })}
      </p>
      {(clientNote.actorName || clientNoteDate) && (
        <p className="mt-1 text-[11.5px] text-[color:var(--text-faint)]">
          {clientNote.actorName && (
            <span>{t('clientActivity.by', { name: clientNote.actorName })}</span>
          )}
          {clientNote.actorName && clientNoteDate && <span aria-hidden> · </span>}
          {clientNoteDate && (
            <span className="font-mono" dir="ltr">
              {clientNoteDate}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** 2. THE ONE ACTION — its eyebrow, headline and hint, and the two quiet lines. */
export function CommandCardHeadline({
  closed,
  copy,
  clientActivity,
  awaitingReplyCount,
}: {
  closed: boolean;
  copy: CommandCardCopy;
  clientActivity: EngagementClientActivityRecord[];
  awaitingReplyCount: number;
}) {
  const tcmd = useTranslations('engagements.command');
  return (
    <>
      {/* The eyebrow carries the ACTOR. A client-actor stage is not a MISSING next
          action — it is a different, healthy one — so it gets its own label rather
          than no label at all, which left the headline floating. */}
      {!closed && (
        <p className="mb-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
          {copy.actor === 'client' ? tcmd('pill.waitingClient') : tcmd('nextAction')}
        </p>
      )}
      <h2 className="mb-1 text-[22px] font-semibold leading-tight tracking-[var(--tracking-title)] text-balance">
        {copy.headline}
      </h2>
      {copy.hint && (
        <p className="mb-4 text-[13.5px] text-[color:var(--text-muted)]">{copy.hint}</p>
      )}

      <ClientNoteCallout clientActivity={clientActivity} />

      {/* Client questions waiting on an answer. ONE line, no button — the reply
          lives on the document itself, in Files. Advisory: it never blocks the
          advance, so it must never look like it does. */}
      {!closed && awaitingReplyCount > 0 && (
        <p className="mb-4 text-[13px] text-[color:var(--text-muted)]">
          {tcmd('awaitingReply', { n: awaitingReplyCount })}
        </p>
      )}
    </>
  );
}
