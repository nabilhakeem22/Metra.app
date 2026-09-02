'use client';

import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  listDocumentComments,
  replyToDocument,
} from '@/lib/engagements/actions/deliverables';
import type { StudioDocumentComment } from '@/lib/engagements/document-comments';
import { useDocumentThread } from '@/lib/engagements/use-document-thread';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';

/** Mirrors the SDF cap and the table's CHECK. Enforced here so the studio sees the
 *  limit while typing rather than after a rejected send. */
const BODY_MAX = 2000;

/**
 * Client Deliverables Step 2 — ONE document's comment thread, on the STUDIO side.
 * Presentation only: the collapsed/lazy/re-read behaviour lives in the shared
 * `useDocumentThread` hook that the client portal's thread uses too, so the two can
 * never drift on behaviour while keeping their own design systems.
 *
 * ADVISORY: replying moves no stage and clears no gate. The awaiting-reply count on
 * the command card is derived from these messages, so it falls when the studio
 * REPLIES — opening a thread deliberately does not clear it.
 *
 * Logical CSS only, so it mirrors in ar-EG RTL; dates sit inside a bidi isolate.
 */
export function DocumentThreadPanel({
  artifactId,
  canReply,
}: {
  artifactId: string;
  canReply: boolean;
}) {
  const t = useTranslations('engagements.comments');
  const locale = useLocale();

  const load = useCallback(() => listDocumentComments(artifactId), [artifactId]);
  const submit = useCallback(
    (body: string) => replyToDocument({ artifactId, body }),
    [artifactId],
  );
  const thread = useDocumentThread<StudioDocumentComment>({ load, send: submit });

  // Unanswered on THIS thread: client messages with no staff message after them.
  // The same rule as countAwaitingReplyCore, applied to the thread already in hand.
  const lastStaffAt = thread.messages.reduce<number>(
    (latest, message) =>
      message.channel === 'staff'
        ? Math.max(latest, new Date(message.createdAt).getTime())
        : latest,
    0,
  );
  const unanswered = thread.messages.filter(
    (message) =>
      message.channel === 'client' &&
      new Date(message.createdAt).getTime() > lastStaffAt,
  ).length;

  return (
    <div>
      <button
        type="button"
        onClick={thread.toggle}
        aria-expanded={thread.open}
        className="inline-flex items-center gap-1.5 rounded-[var(--r-item)] px-2 py-1 text-xs font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]"
      >
        <MessageSquare className="size-3.5" aria-hidden />
        {thread.loaded && thread.messages.length === 0 ? t('none') : t('open')}
        {thread.loaded && unanswered > 0 && (
          <span className="rounded-full bg-[color:var(--warn-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]">
            {unanswered}
          </span>
        )}
      </button>

      {thread.open && (
        <div className="mt-2 space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-3">
          {thread.loading && !thread.loaded ? (
            <p className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('loading')}
            </p>
          ) : thread.messages.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">{t('empty')}</p>
          ) : (
            <ul className="space-y-2">
              {thread.messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.channel === 'client'
                      ? 'rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--card)] p-2.5'
                      : 'rounded-[var(--r-item)] border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] p-2.5'
                  }
                >
                  <p className="text-[11px] font-semibold text-[color:var(--text-muted)]">
                    {message.channel === 'client'
                      ? message.authorName || t('client')
                      : t('studio')}
                    <span className="ms-2 font-normal" dir="ltr">
                      {bidiIsolate(formatDate(message.createdAt, locale))}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs">
                    {message.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canReply && (
            <div className="space-y-1.5">
              <label htmlFor={`reply-${artifactId}`} className="sr-only">
                {t('placeholder')}
              </label>
              <textarea
                id={`reply-${artifactId}`}
                value={thread.draft}
                maxLength={BODY_MAX}
                onChange={(event) => thread.setDraft(event.target.value)}
                placeholder={t('placeholder')}
                rows={2}
                className="w-full resize-y rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--card)] p-2 text-xs focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {t('advisory')}
                </p>
                <Button
                  size="sm"
                  disabled={thread.sending || !thread.draft.trim()}
                  onClick={thread.send}
                >
                  {thread.sending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-3.5" aria-hidden />
                  )}
                  {t('reply')}
                </Button>
              </div>
              {thread.error && (
                <p className="text-xs text-[color:var(--danger)]" role="alert">
                  {t(`error.${thread.error}`)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
