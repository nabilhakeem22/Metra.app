'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { getDeliverableUrl } from '@/lib/engagements/actions';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { validateDeliverableFile } from '@/lib/engagements/deliverable-files';
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
 * card's dropzone. `uploadMany` takes every file the studio picked or dropped
 * and uploads them ONE AFTER ANOTHER in a single transition, each through
 * `uploadDeliverableFile`; once `maxFiles` have LANDED (concept options are
 * capped and append-only) the rest are skipped. Each file's status, and why it failed,
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
    const batch = `${Date.now()}`;
    const items: UploadQueueItem[] = files.map((file, index) => ({
      key: `${batch}-${index}`,
      name: file.name,
      status: 'queued',
      message: null,
    }));
    setQueue(items);

    startTransition(async () => {
      // Only a file that actually LANDS takes one of the capped slots: a file
      // the pre-flight refuses, or an upload that fails, leaves its slot for the
      // next file, and "limit reached" is said only once the cap really is.
      let slotsLeft = maxFiles ?? Number.POSITIVE_INFINITY;
      let done = 0;
      let failed = 0;
      for (const [index, file] of files.entries()) {
        const key = items[index].key;
        const localError = validateDeliverableFile(category, file.name, file.size);
        if (localError) {
          failed += 1;
          const reason = localError === 'file_too_large' ? 'too_large' : 'wrong_type';
          setItem(key, { status: 'failed', message: messageOf({ ok: false, reason }) });
          continue;
        }
        if (slotsLeft <= 0) {
          setItem(key, { status: 'skipped' });
          continue;
        }
        setItem(key, { status: 'uploading' });
        const outcome = await uploadDeliverableFile(engagementId, category, file);
        if (outcome.ok) {
          done += 1;
          slotsLeft -= 1;
        } else {
          failed += 1;
        }
        setItem(key, { status: outcome.ok ? 'done' : 'failed', message: messageOf(outcome) });
      }
      // A failure may still have landed server-side (or the cap moved under us):
      // refresh so the card's count and dropzone match the ledger either way.
      if (done > 0 || failed > 0) router.refresh();
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
