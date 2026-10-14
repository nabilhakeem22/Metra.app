'use client';

import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Textarea } from '@/components/ui/textarea';
import { COMMENT_MAX } from '@/lib/engagements/comment-field-rules';
import { ownSentComment, threadMessagesOrThrow } from '@/lib/engagements/portal-thread-read';
import type { PublicDocumentComment } from '@/lib/engagements/public-comments';
import { useDocumentThread } from '@/lib/engagements/use-document-thread';
import { addDeliveryComment, loadDeliveryDocumentComments, type DeliveryCommentActResult } from '../actions';
import { DocumentThreadBody } from './document-thread-messages';
import { useCommentRefusals } from './use-comment-refusals';

/**
 * Client Deliverables Step 2: ONE released document's comment thread, on the client
 * portal. The collapsed/lazy/re-read behaviour lives in the shared
 * `useDocumentThread` hook, which the studio's panel uses too.
 *
 * ADVISORY, and the copy says so: a comment is a question about this drawing, NOT a
 * revision request; the stage buttons remain the only way to move anything.
 *
 * After a send, the thread says the team has been notified only when the portal
 * action says it was, and the page re-reads itself. Send is never disabled for an
 * empty box: pressing it says, under the box, what is missing
 * (./use-comment-refusals.ts). Logical CSS only, so it mirrors in RTL.
 */
export function DocumentThread({
  token,
  documentId,
  initialCount,
  inLightbox = false,
}: {
  token: string;
  documentId: string;
  initialCount: number;
  /** In the lightbox the page's buttons are behind the view: the hint says so (F13). */
  inLightbox?: boolean;
}) {
  const t = useTranslations('delivery.comments');
  const router = useRouter();
  // Did the LAST message sent from here reach the studio? Only then may the
  // thread say the team has been notified.
  const [studioNotified, setStudioNotified] = useState(false);

  const load = useCallback(
    async () => threadMessagesOrThrow(await loadDeliveryDocumentComments(token, documentId)),
    [token, documentId],
  );
  const submit = useCallback(
    async (body: string) => {
      setStudioNotified(false);
      const result = await addDeliveryComment(token, documentId, body);
      setStudioNotified(result.studioNotified === true);
      // The page's message counts and anything the studio changed meanwhile.
      if (result.ok) router.refresh();
      return result;
    },
    [token, documentId, router],
  );
  const refused = useCommentRefusals();
  const thread = useDocumentThread<PublicDocumentComment, DeliveryCommentActResult>({
    load,
    send: submit,
    echo: ownSentComment,
    refusals: refused.refusals,
  });
  const boxId = `comment-${documentId}`;
  function send() {
    if (refused.precheck(thread.draft)) return;
    thread.send();
  }

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
          <DocumentThreadBody thread={thread} />

          <div ref={refused.boxRef} className="space-y-1.5">
            <label htmlFor={boxId} className="sr-only">
              {t('placeholder')}
            </label>
            <Textarea
              id={boxId}
              value={thread.draft}
              maxLength={COMMENT_MAX}
              aria-invalid={refused.bodyError ? true : undefined}
              aria-describedby={refused.bodyError ? fieldErrorId(boxId) : undefined}
              onChange={(event) => {
                refused.onBodyEdit();
                thread.setDraft(event.target.value);
              }}
              placeholder={t('placeholder')}
              rows={2}
              dir="auto"
              className="resize-y"
            />
            <FieldErrorText id={fieldErrorId(boxId)} message={refused.bodyError} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption text-muted-foreground">{t(inLightbox ? 'advisoryLightbox' : 'advisory')}</p>
              <Button variant="secondary" size="sm" disabled={thread.sending} onClick={send}>
                {thread.sending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-3.5" aria-hidden />
                )}
                {t('send')}
              </Button>
            </div>
            {studioNotified && !thread.error && !refused.failureText && (
              <p className="text-caption text-muted-foreground" role="status">
                {t('notified')}
              </p>
            )}
            {refused.failureText && (
              <p className="text-caption text-destructive" role="alert">
                {refused.failureText}
              </p>
            )}
            {thread.error && (
              <p className="text-caption text-destructive" role="alert">
                {t('error.load_failed')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
