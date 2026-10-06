'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { getDeliverableUrl } from '@/lib/engagements/actions';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { formatNumber } from '@/lib/format/number';
import { uploadDeliverableFile, type DeliverableUploadOutcome } from './upload-deliverable';

export interface UploadQueueItem {
  key: string;
  name: string;
  status: 'queued' | 'uploading' | 'done' | 'failed' | 'skipped';
  /** Why a file failed, localized; null otherwise. */
  message: string | null;
}

/**
 * The shared deliverable upload, for the working-files tray AND the command
 * card's dropzone. `uploadMany` takes every file the studio picked or dropped,
 * marks the ones past `maxFiles` as skipped (concept options are capped and
 * append-only), then uploads the rest ONE AFTER ANOTHER in a single transition,
 * each through `uploadDeliverableFile`. Each file's status, and why it failed,
 * stays in `queue` beside it. Afterwards: one refresh if anything landed, and one
 * summary toast. Nothing here advances the delivery.
 */
export function useDeliverableUpload(engagementId: string): {
  pending: boolean;
  queue: UploadQueueItem[];
  uploadMany: (category: WorkingFileCategory, files: File[], maxFiles?: number) => void;
  download: (fileId: string) => void;
} {
  const t = useTranslations('engagements.files');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);

  function messageOf(outcome: DeliverableUploadOutcome): string | null {
    if (outcome.ok) return null;
    if (outcome.reason === 'too_large') return t('tooLarge');
    if (outcome.reason === 'wrong_type') return t('wrongType');
    if (outcome.reason === 'put_failed') return te('generic');
    return resolveActionError(outcome.reason as ActionCode, te);
  }

  function setItem(key: string, patch: Partial<UploadQueueItem>): void {
    setQueue((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function uploadMany(category: WorkingFileCategory, files: File[], maxFiles?: number): void {
    if (files.length === 0) return;
    const limit = maxFiles ?? files.length;
    const batch = `${Date.now()}`;
    const items: UploadQueueItem[] = files.map((file, index) => ({
      key: `${batch}-${index}`,
      name: file.name,
      status: index < limit ? 'queued' : 'skipped',
      message: null,
    }));
    setQueue(items);

    startTransition(async () => {
      let done = 0;
      for (const [index, file] of files.entries()) {
        if (index >= limit) continue;
        const key = items[index].key;
        setItem(key, { status: 'uploading' });
        const outcome = await uploadDeliverableFile(engagementId, category, file);
        if (outcome.ok) done += 1;
        setItem(key, { status: outcome.ok ? 'done' : 'failed', message: messageOf(outcome) });
      }
      if (done > 0) router.refresh();
      toast({
        title: t('uploadedSummary', {
          done: formatNumber(done, locale),
          total: formatNumber(files.length, locale),
        }),
        variant: done === 0 ? 'destructive' : undefined,
      });
    });
  }

  function download(fileId: string) {
    startTransition(async () => {
      const res = await getDeliverableUrl(fileId);
      if (res.ok && res.url) window.open(res.url, '_blank', 'noopener');
    });
  }

  return { pending, queue, uploadMany, download };
}
