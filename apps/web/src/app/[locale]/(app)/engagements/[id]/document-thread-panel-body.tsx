'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { StudioDocumentComment } from '@/lib/engagements/document-comments';
import type { DocumentThread } from '@/lib/engagements/use-document-thread';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';

/**
 * The studio thread panel's body: a spinner while the first read is in flight,
 * the messages, and "No messages on this file yet" ONLY after a read completed
 * (a failed read is not an empty thread). Messages shown after a failed read
 * say some may be missing. Dates sit inside a bidi isolate.
 */
export function DocumentThreadPanelBody({
  thread,
}: {
  thread: Pick<DocumentThread<StudioDocumentComment>, 'loading' | 'loaded' | 'messages' | 'partial'>;
}) {
  const t = useTranslations('engagements.comments');
  const locale = useLocale();
  if (thread.loading && !thread.loaded) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-[color:var(--text-muted)]">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('loading')}
      </p>
    );
  }
  if (thread.messages.length === 0) {
    return thread.loaded ? <p className="text-caption text-[color:var(--text-muted)]">{t('empty')}</p> : null;
  }
  return (
    <>
      <ul className="space-y-2">
        {thread.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.channel === 'client'
                ? 'rounded-item border border-[color:var(--rule)] bg-card p-2.5'
                : 'rounded-item border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] p-2.5'
            }
          >
            <p className="text-caption font-semibold text-[color:var(--text-muted)]">
              {message.channel === 'client' ? message.authorName || t('client') : t('studio')}
              <span className="ms-2 font-normal" dir="ltr">
                {bidiIsolate(formatDate(message.createdAt, locale))}
              </span>
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-caption">{message.body}</p>
          </li>
        ))}
      </ul>
      {thread.partial && <p className="text-caption text-[color:var(--text-muted)]">{t('partial')}</p>}
    </>
  );
}
