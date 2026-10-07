'use client';

import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PublicDocumentComment } from '@/lib/engagements/public-comments';
import { useDocumentThread } from '@/lib/engagements/use-document-thread';
import { addDeliveryComment, loadDeliveryDocumentComments } from '../actions';
import { DocumentThreadMessages } from './document-thread-messages';
import { Textarea } from '@/components/ui/textarea';

/** Hard cap, mirrored from the SDF and the table's CHECK. Enforced here only so the
 *  client sees the limit while typing rather than after a rejected send. */
const BODY_MAX = 2000;

/**
 * Client Deliverables Step 2 — ONE released document's comment thread, on the client
 * portal. Presentation only: the collapsed/lazy/re-read behaviour lives in the
 * shared `useDocumentThread` hook, which the studio's panel uses too, so the two
 * surfaces can never drift apart on behaviour while keeping their own design system.
 *
 * ADVISORY, and the copy says so: a comment is a question about this drawing, NOT a
 * revision request. The stage approve / request-changes buttons remain the only way
 * to move anything, so a client who comments can never end up waiting on a stage
 * that is in fact waiting on them.
 *
 * The messages render in DocumentThreadMessages. After a send, the thread says
 * the team has been notified only when the portal action says it was. Logical
 * CSS only, so it mirrors correctly in RTL.
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
  // Did the LAST message sent from here reach the studio? Only then may the
  // thread say the team has been notified.
  const [studioNotified, setStudioNotified] = useState(false);

  const load = useCallback(
    () => loadDeliveryDocumentComments(token, documentId),
    [token, documentId],
  );
  const submit = useCallback(
    async (body: string) => {
      setStudioNotified(false);
      const result = await addDeliveryComment(token, documentId, body);
      setStudioNotified(result.studioNotified === true);
      return result;
    },
    [token, documentId],
  );
  const thread = useDocumentThread<PublicDocumentComment>({ load, send: submit });

  // The server's count until the thread has really loaded, then its own length
  // (which reflects whatever was just sent).
  const count = thread.loaded ? thread.messages.length : initialCount;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={thread.toggle}
        aria-expanded={thread.open}
        className="inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-caption font-medium text-muted-foreground hover:bg-muted hover:text-foreground coarse:min-h-11"
      >
        <MessageSquare className="size-3.5" aria-hidden />
        {count > 0 ? t('toggleCount', { count }) : t('toggleEmpty')}
      </button>

      {thread.open && (
        <div className="mt-2 space-y-3 rounded-item border bg-muted/30 p-3">
          {thread.loading && !thread.loaded ? (
            <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('loading')}
            </p>
          ) : thread.messages.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t('empty')}</p>
          ) : (
            <DocumentThreadMessages messages={thread.messages} />
          )}

          <div className="space-y-1.5">
            <label htmlFor={`comment-${documentId}`} className="sr-only">
              {t('placeholder')}
            </label>
            <Textarea
              id={`comment-${documentId}`}
              value={thread.draft}
              maxLength={BODY_MAX}
              onChange={(event) => thread.setDraft(event.target.value)}
              placeholder={t('placeholder')}
              rows={2}
              dir="auto"
              className="resize-y"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption text-muted-foreground">{t('advisory')}</p>
              <Button
                variant="secondary"
                size="sm"
                disabled={thread.sending || !thread.draft.trim()}
                onClick={thread.send}
              >
                {thread.sending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-3.5" aria-hidden />
                )}
                {t('send')}
              </Button>
            </div>
            {studioNotified && !thread.error && (
              <p className="text-caption text-muted-foreground" role="status">
                {t('notified')}
              </p>
            )}
            {thread.error && (
              <p className="text-caption text-destructive" role="alert">
                {t(`error.${thread.error}`)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
