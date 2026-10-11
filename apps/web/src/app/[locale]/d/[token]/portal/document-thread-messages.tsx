'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicDocumentComment } from '@/lib/engagements/public-comments';
import type { DocumentThread } from '@/lib/engagements/use-document-thread';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';

/**
 * The messages of ONE document thread, as the client sees them. The studio's
 * replies are attributed to the firm, never to a named member (the read SDF
 * returns no staff names). Dates use Western numerals inside a bidi isolate.
 */
function DocumentThreadMessages({ messages }: { messages: PublicDocumentComment[] }) {
  const t = useTranslations('delivery.comments');
  const locale = useLocale();
  return (
    <ul className="space-y-2">
      {messages.map((message) => (
        <li
          key={message.id}
          className={
            message.channel === 'client'
              ? 'rounded-item bg-background p-2.5 shadow-sm'
              : 'rounded-item border border-primary/20 bg-primary/5 p-2.5'
          }
        >
          <p className="text-caption font-semibold text-muted-foreground">
            {message.channel === 'client' ? message.authorName || t('you') : t('studio')}
            {message.createdAt && (
              <span className="ms-2 font-normal">
                {bidiIsolate(formatDate(message.createdAt, locale))}
              </span>
            )}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-caption">{message.body}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The thread's body: a spinner while the first read is in flight, the messages,
 * and "No messages yet" ONLY after a read completed (a refused read is not an
 * empty thread). Messages shown after a failed read say some may be missing.
 */
export function DocumentThreadBody({
  thread,
}: {
  thread: Pick<DocumentThread<PublicDocumentComment>, 'loading' | 'loaded' | 'messages' | 'partial'>;
}) {
  const t = useTranslations('delivery.comments');
  if (thread.loading && !thread.loaded) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('loading')}
      </p>
    );
  }
  if (thread.messages.length === 0) {
    return thread.loaded ? <p className="text-caption text-muted-foreground">{t('empty')}</p> : null;
  }
  return (
    <>
      <DocumentThreadMessages messages={thread.messages} />
      {thread.partial && <p className="text-caption text-muted-foreground">{t('partial')}</p>}
    </>
  );
}
