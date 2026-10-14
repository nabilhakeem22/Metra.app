'use client';

import { Loader2, MessageSquare, Send } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { ActionResult } from '@/lib/actions/result';
import {
  listDocumentComments,
  replyToDocument,
} from '@/lib/engagements/actions/deliverables';
import { COMMENT_FIELDS, commentFieldErrors } from '@/lib/engagements/comment-field-rules';
import type { StudioDocumentComment } from '@/lib/engagements/document-comments';
import { ownStudioReply } from '@/lib/engagements/studio-reply-echo';
import { unansweredClientMessages } from '@/lib/engagements/thread-unanswered';
import { useDocumentThread } from '@/lib/engagements/use-document-thread';
import { DocumentThreadPanelBody } from './document-thread-panel-body';
import { FormRefusal } from './form-refusal';

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
 * A reply whose re-read fails stays on screen (ownStudioReply), and a read that
 * fails says so to every viewer, reply rights or not. A reply the server refuses
 * is said under the reply box, or above it when it is about something else.
 *
 * Logical CSS only, so it mirrors in ar-EG RTL.
 */
export function DocumentThreadPanel({
  artifactId,
  canReply,
}: {
  artifactId: string;
  canReply: boolean;
}) {
  const t = useTranslations('engagements.comments');
  const te = useTranslations('errors');
  const replyId = `reply-${artifactId}`;
  const errors = useFieldErrors({ fields: COMMENT_FIELDS, translate: te });
  const replyRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(replyRef, errors.invalidAttempt);

  const load = useCallback(() => listDocumentComments(artifactId), [artifactId]);
  const submit = useCallback(
    (body: string) => replyToDocument({ artifactId, body }),
    [artifactId],
  );
  const thread = useDocumentThread<StudioDocumentComment, ActionResult>({
    load,
    send: submit,
    echo: ownStudioReply,
    refusals: errors,
  });
  const bodyRefusal = errors.messageFor('body');
  function send() {
    if (errors.applyLocal(commentFieldErrors(thread.draft))) return;
    thread.send();
  }

  const unanswered = unansweredClientMessages(thread.messages);

  return (
    <div>
      <button
        type="button"
        onClick={thread.toggle}
        aria-expanded={thread.open}
        className="inline-flex items-center gap-1.5 rounded-item px-2 py-1 text-caption font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]"
      >
        <MessageSquare className="size-3.5" aria-hidden />
        {thread.loaded && thread.messages.length === 0 ? t('none') : t('open')}
        {thread.loaded && unanswered > 0 && (
          <span className="rounded-pill bg-[color:var(--warn-tint)] px-1.5 py-0.5 text-caption font-semibold text-[color:var(--warn)]">
            {unanswered}
          </span>
        )}
      </button>

      {thread.open && (
        <div className="mt-2 space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-3">
          <DocumentThreadPanelBody thread={thread} />

          {canReply && (
            <div ref={replyRef} className="space-y-1.5">
              <label htmlFor={replyId} className="sr-only">
                {t('placeholder')}
              </label>
              <Textarea
                id={replyId}
                value={thread.draft}
                maxLength={BODY_MAX}
                aria-invalid={bodyRefusal ? true : undefined}
                aria-describedby={bodyRefusal ? fieldErrorId(replyId) : undefined}
                onChange={(event) => {
                  errors.bind('body').onEdit();
                  thread.setDraft(event.target.value);
                }}
                placeholder={t('placeholder')}
                rows={2}
                dir="auto"
                className="resize-y"
              />
              <FieldErrorText id={fieldErrorId(replyId)} message={bodyRefusal} />
              <FormRefusal message={errors.formError} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-caption text-[color:var(--text-muted)]">
                  {t('advisory')}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={thread.sending}
                  onClick={send}
                >
                  {thread.sending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-3.5" aria-hidden />
                  )}
                  {t('reply')}
                </Button>
              </div>
            </div>
          )}
          {thread.error && (
            <p className="text-caption text-[color:var(--danger)]" role="alert">
              {t(`error.${thread.error}`)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
