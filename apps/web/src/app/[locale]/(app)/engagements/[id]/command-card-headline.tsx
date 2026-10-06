'use client';

import { useLocale, useTranslations } from 'next-intl';
import { currentChangeRequestNote } from '@/lib/engagements/client-activity-note';
import type { ClientDecisionSummary } from '@/lib/engagements/gate-preview';
import type { EngagementClientActivityRecord } from '@/lib/engagements/queries/client-activity';
import type { DesignState } from '@/lib/engagements/states';
import { formatDate } from '@/lib/format/date';
import type { CommandCardCopy } from './command-card-copy';
import { SectionLabel } from '@/components/ui/section-label';

/**
 * The client's own words — a QUIET callout under the headline, never a second CTA.
 * Plain text: React escapes it, so client-authored input can never inject markup.
 * Logical CSS only, so it mirrors in ar-EG.
 */
function ClientNoteCallout({
  clientActivity,
  review,
}: {
  clientActivity: EngagementClientActivityRecord[];
  review: { state: DesignState; clientDecision: ClientDecisionSummary | null };
}) {
  const t = useTranslations('engagements');
  const tcmd = useTranslations('engagements.command');
  const locale = useLocale();
  // The brief for the revision the studio is about to make. It belongs next to
  // the headline, not buried in the timeline tab. Null when the client has asked
  // for nothing (or asked with no words), never an approval's note, and at a
  // review stage never a note from an earlier round.
  const clientNote = currentChangeRequestNote(clientActivity, review);
  if (!clientNote) return null;
  const clientNoteDate = formatDate(clientNote.decidedAt, locale);
  return (
    <div className="mb-4 rounded-panel border border-[color:var(--rule)] bg-[color:var(--track)] px-3 py-2.5">
      <SectionLabel>{tcmd('clientNote')}</SectionLabel>
      {/* Clamped to 4 lines: a long client note must never push the primary
          Advance CTA below the fold — the whole point of this card is one
          unmissable next action. The full text is always in the Timeline. */}
      <p className="mt-1 line-clamp-4 whitespace-pre-line break-words text-small text-[color:var(--text)]">
        {t('noteQuote', { note: clientNote.note })}
      </p>
      {(clientNote.actorName || clientNoteDate) && (
        <p className="mt-1 text-caption text-[color:var(--text-faint)]">
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
  review,
  awaitingReplyCount,
}: {
  closed: boolean;
  copy: CommandCardCopy;
  clientActivity: EngagementClientActivityRecord[];
  /** The stage and the client's decision on its current round (gate preview). */
  review: { state: DesignState; clientDecision: ClientDecisionSummary | null };
  awaitingReplyCount: number;
}) {
  const tcmd = useTranslations('engagements.command');
  return (
    <>
      {/* The eyebrow carries the ACTOR. A client-actor stage is not a MISSING next
          action — it is a different, healthy one — so it gets its own label rather
          than no label at all, which left the headline floating. */}
      {!closed && (
        <SectionLabel className="mb-1.5">
          {copy.actor === 'client' ? tcmd('pill.waitingClient') : tcmd('nextAction')}
        </SectionLabel>
      )}
      <h2 className="mb-1 text-heading font-semibold leading-tight text-balance">
        {copy.headline}
      </h2>
      {copy.hint && (
        <p className="mb-4 text-small text-[color:var(--text-muted)]">{copy.hint}</p>
      )}

      <ClientNoteCallout clientActivity={clientActivity} review={review} />

      {/* Client questions waiting on an answer. ONE line, no button — the reply
          lives on the document itself, in Files. Advisory: it never blocks the
          advance, so it must never look like it does. */}
      {!closed && awaitingReplyCount > 0 && (
        <p className="mb-4 text-small text-[color:var(--text-muted)]">
          {tcmd('awaitingReply', { n: awaitingReplyCount })}
        </p>
      )}
    </>
  );
}
