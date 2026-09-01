'use client';

import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { PublicDocumentComment } from '@/lib/engagements/public';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { addDeliveryComment, loadDeliveryDocumentComments } from '../actions';

/** Hard cap, mirrored from the SDF and the table's CHECK. Enforced here only so the
 *  client sees the limit while typing rather than after a rejected send. */
const BODY_MAX = 2000;

/**
 * Client Deliverables Step 2 — ONE released document's comment thread, on the client
 * portal. Collapsed by default and LAZY: nothing is fetched until the client opens
 * it, so a portal with twenty documents still makes exactly one read on first paint
 * and carries no message bodies in its payload.
 *
 * ADVISORY, and the copy says so: a comment is a question about this drawing, NOT a
 * revision request. The stage approve / request-changes buttons remain the only way
 * to move anything, so a client who comments can never end up waiting on a stage
 * that is in fact waiting on them.
 *
 * The studio's replies are attributed to the firm, never to a named member — the
 * read SDF does not return staff names. Dates use Western numerals inside a bidi
 * isolate; logical CSS only, so it mirrors correctly in RTL.
 */
export function DocumentThread({
  token,
  documentId,
  initialCount,
}: {
  token: string;
  documentId: string;
  initialCount: number;
}) {
  const t = useTranslations('delivery.comments');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [thread, setThread] = useState<PublicDocumentComment[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  // The count shown on the toggle: the server's number until we have really loaded
  // the thread, then the thread's own length (which reflects what was just sent).
  const count = loaded ? thread.length : initialCount;

  function fetchThread() {
    startLoading(async () => {
      try {
        setThread(await loadDeliveryDocumentComments(token, documentId));
        setLoaded(true);
      } catch {
        setError('generic');
      }
    });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    // Fetch on the FIRST open only; re-opening reuses what we already have.
    if (next && !loaded && !loading) fetchThread();
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    startSending(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const result = await addDeliveryComment(token, documentId, body);
        if (!result.ok) {
          setError(result.error ?? 'generic');
          return;
        }
        setDraft('');
        // Re-read rather than appending locally: the server row carries the real
        // timestamp, and a refetch also surfaces any studio reply sent meanwhile.
        setThread(await loadDeliveryDocumentComments(token, documentId));
        setLoaded(true);
      } catch {
        setError('generic');
      }
    });
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MessageSquare className="size-3.5" aria-hidden />
        {count > 0 ? t('toggleCount', { count }) : t('toggleEmpty')}
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-xl border bg-muted/30 p-3">
          {loading && !loaded ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('loading')}
            </p>
          ) : thread.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-2">
              {thread.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.channel === 'client'
                      ? 'rounded-xl bg-background p-2.5 shadow-sm'
                      : 'rounded-xl border border-primary/20 bg-primary/5 p-2.5'
                  }
                >
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    {message.channel === 'client'
                      ? message.authorName || t('you')
                      : t('studio')}
                    {message.createdAt && (
                      <span className="ms-2 font-normal">
                        {bidiIsolate(formatDate(message.createdAt, locale))}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs">
                    {message.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            <label htmlFor={`comment-${documentId}`} className="sr-only">
              {t('placeholder')}
            </label>
            <textarea
              id={`comment-${documentId}`}
              value={draft}
              maxLength={BODY_MAX}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('placeholder')}
              rows={2}
              className="w-full resize-y rounded-lg border bg-background p-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">{t('advisory')}</p>
              <Button size="sm" disabled={sending || !draft.trim()} onClick={send}>
                {sending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-3.5" aria-hidden />
                )}
                {t('send')}
              </Button>
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {t(`error.${error}`)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
