'use client';

import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  listDocumentComments,
  replyToDocument,
} from '@/lib/engagements/actions/deliverables';
import type { StudioDocumentComment } from '@/lib/engagements/document-comments';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';

/** Mirrors the SDF cap and the table's CHECK. Enforced here so the studio sees the
 *  limit while typing rather than after a rejected send. */
const BODY_MAX = 2000;

/**
 * Client Deliverables Step 2 — ONE document's comment thread, on the STUDIO side.
 * The mirror of the portal's DocumentThread: collapsed by default and LAZY, so the
 * cockpit's first paint carries no message bodies however many files an engagement
 * has.
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
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [thread, setThread] = useState<StudioDocumentComment[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function refresh(): void {
    startLoading(async () => {
      try {
        setThread(await listDocumentComments(artifactId));
        setLoaded(true);
      } catch {
        setError('generic');
      }
    });
  }

  function toggle(): void {
    const next = !open;
    setOpen(next);
    setError(null);
    // Fetch on the FIRST open only; re-opening reuses what we already have.
    if (next && !loaded && !loading) refresh();
  }

  function send(): void {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    startSending(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const result = await replyToDocument({ artifactId, body });
        if (!result.ok) {
          setError(result.error ?? 'generic');
          return;
        }
        setDraft('');
        setThread(await listDocumentComments(artifactId));
        setLoaded(true);
      } catch {
        setError('generic');
      }
    });
  }

  // Unanswered on THIS thread: client messages with no staff message after them.
  // Same rule as countAwaitingReplyCore, applied to the thread already in hand.
  const lastStaffAt = thread.reduce<number>(
    (latest, message) =>
      message.channel === 'staff'
        ? Math.max(latest, new Date(message.createdAt).getTime())
        : latest,
    0,
  );
  const unanswered = thread.filter(
    (message) =>
      message.channel === 'client' &&
      new Date(message.createdAt).getTime() > lastStaffAt,
  ).length;

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-[var(--r-item)] px-2 py-1 text-xs font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]"
      >
        <MessageSquare className="size-3.5" aria-hidden />
        {loaded && thread.length === 0 ? t('none') : t('open')}
        {loaded && unanswered > 0 && (
          <span className="rounded-full bg-[color:var(--warn-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]">
            {unanswered}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-3">
          {loading && !loaded ? (
            <p className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('loading')}
            </p>
          ) : thread.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">{t('empty')}</p>
          ) : (
            <ul className="space-y-2">
              {thread.map((message) => (
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
                value={draft}
                maxLength={BODY_MAX}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('placeholder')}
                rows={2}
                className="w-full resize-y rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--card)] p-2 text-xs focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {t('advisory')}
                </p>
                <Button size="sm" disabled={sending || !draft.trim()} onClick={send}>
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-3.5" aria-hidden />
                  )}
                  {t('reply')}
                </Button>
              </div>
              {error && (
                <p className="text-xs text-[color:var(--danger)]" role="alert">
                  {t(`error.${error}`)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
