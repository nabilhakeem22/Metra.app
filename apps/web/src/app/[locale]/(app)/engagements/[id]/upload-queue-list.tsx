'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import type { UploadQueueItem } from './upload-queue-item';

const STATUS_TONE: Record<UploadQueueItem['status'], string> = {
  queued: 'text-[color:var(--text-muted)]',
  uploading: 'text-brand-ink',
  done: 'text-[color:var(--success)]',
  failed: 'text-destructive',
  skipped: 'text-[color:var(--warn)]',
};

/**
 * Each picked file, its status, a progress bar while it uploads, and why it
 * failed, beside it. A failed transfer offers its own Retry; with two or more,
 * one "Retry failed" runs them all. Retries are off while any upload runs.
 * Renders nothing when empty.
 */
export function UploadQueueList({
  queue,
  pending,
  onRetry,
  onRetryFailed,
}: {
  queue: UploadQueueItem[];
  pending: boolean;
  onRetry: (key: string) => void;
  onRetryFailed: () => void;
}) {
  const t = useTranslations('engagements.files');
  const idPrefix = useId();
  if (queue.length === 0) return null;
  const retryableCount = queue.filter((item) => item.retryable).length;
  return (
    <div className="mt-2 space-y-2">
      <ul className="space-y-1 text-caption" aria-live="polite">
        {queue.map((item) => {
          const nameId = `${idPrefix}-${item.key}`;
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span id={nameId} className="min-w-0 truncate" dir="auto">
                {item.name}
              </span>
              <span className={`font-semibold ${STATUS_TONE[item.status]}`}>
                {t(`status.${item.status}`)}
              </span>
              {item.status === 'uploading' && item.progress !== null && (
                <div
                  role="progressbar"
                  aria-labelledby={nameId}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.progress}
                  className="h-1.5 w-24 overflow-hidden rounded-full bg-[color:var(--track)]"
                >
                  <span className="block h-full rounded-full bg-brand" style={{ inlineSize: `${item.progress}%` }} />
                </div>
              )}
              {item.message && (
                <span className="text-destructive" role="alert">
                  {item.message}
                </span>
              )}
              {item.retryable && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  aria-label={t('retryFile', { name: item.name })}
                  onClick={() => onRetry(item.key)}
                >
                  {t('retry')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {retryableCount >= 2 && (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onRetryFailed}>
          {t('retryFailed')}
        </Button>
      )}
    </div>
  );
}
