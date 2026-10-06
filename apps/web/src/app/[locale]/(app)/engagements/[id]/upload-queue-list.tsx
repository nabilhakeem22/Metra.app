'use client';

import { useTranslations } from 'next-intl';
import type { UploadQueueItem } from './use-deliverable-upload';

const STATUS_TONE: Record<UploadQueueItem['status'], string> = {
  queued: 'text-[color:var(--text-muted)]',
  uploading: 'text-brand-ink',
  done: 'text-[color:var(--success)]',
  failed: 'text-destructive',
  skipped: 'text-[color:var(--warn)]',
};

/** Each picked file, its status, and why it failed, beside it. Renders nothing when empty. */
export function UploadQueueList({ queue }: { queue: UploadQueueItem[] }) {
  const t = useTranslations('engagements.files.status');
  if (queue.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-caption" aria-live="polite">
      {queue.map((item) => (
        <li key={item.key} className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 truncate" dir="auto">
            {item.name}
          </span>
          <span className={`font-semibold ${STATUS_TONE[item.status]}`}>{t(item.status)}</span>
          {item.message && (
            <span className="text-destructive" role="alert">
              {item.message}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
