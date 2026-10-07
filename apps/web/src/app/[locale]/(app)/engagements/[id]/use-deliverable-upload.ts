'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { getDeliverableUrl } from '@/lib/engagements/actions';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { formatNumber } from '@/lib/format/number';
import { uploadDeliverableFile, type DeliverableUploadOutcome } from './upload-deliverable';
import {
  queuedItem,
  settledPatch,
  SKIPPED_PATCH,
  UPLOADING_PATCH,
  type UploadQueueItem,
} from './upload-queue-item';
import { runUploadQueue, type QueuedFile } from './upload-queue-run';

/**
 * The shared deliverable upload, for the working-files tray AND the command
 * card's dropzone. `uploadMany` uploads every picked or dropped file ONE AFTER
 * ANOTHER in one run; once `maxFiles` have LANDED (concept options are
 * capped and append-only) the rest are skipped. Each file's status, progress and
 * failure reason stay in `queue`. A failed TRANSFER can be retried alone (`retry`)
 * or together (`retryFailed`), against the caller's CURRENT cap. After each run:
 * one refresh if anything landed or failed, one summary toast. Nothing here
 * advances the delivery.
 */
export function useDeliverableUpload(engagementId: string): {
  pending: boolean;
  queue: UploadQueueItem[];
  uploadMany: (category: WorkingFileCategory, files: File[], maxFiles?: number) => void;
  retry: (key: string, maxFiles?: number) => void;
  retryFailed: (maxFiles?: number) => void;
  download: (fileId: string) => void;
} {
  const t = useTranslations('engagements.files');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  // Uploads track their own flag rather than a transition: an update made inside
  // an async transition is held until the whole action ends, so the first file's
  // "Uploading" and its progress would never paint while it uploads.
  const [uploading, setUploading] = useState(false);
  const running = useRef(false);
  const [downloading, startDownload] = useTransition();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  // The files of the CURRENT batch by queue key, so a retry can send one again.
  const batchFiles = useRef(new Map<string, QueuedFile>());
  // Leaving the page abandons the transfer in flight and the rest of the queue:
  // no upload, refresh or toast lands on a page the studio has moved on to.
  const leaving = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, []);

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

  /** Upload one queued file, keeping its row current. True when it landed. */
  async function uploadOne(key: string, queued: QueuedFile): Promise<boolean> {
    setItem(key, UPLOADING_PATCH);
    const outcome = await uploadDeliverableFile(engagementId, queued.category, queued.file, {
      onProgress: (progress) => setItem(key, { progress }),
      signal: leaving.current.signal,
      resume: queued.resume,
    });
    // The page has gone: nothing left to tell, and no row to update.
    if (!outcome.ok && outcome.reason === 'aborted') return false;
    queued.resume = outcome.ok ? undefined : outcome.resume;
    setItem(key, settledPatch(outcome, messageOf(outcome)));
    return outcome.ok;
  }

  async function run(keys: string[], maxFiles: number | undefined): Promise<void> {
    running.current = true;
    setUploading(true);
    try {
      const signal = leaving.current.signal;
      const steps = {
        upload: uploadOne,
        refuse: (key: string, refusal: DeliverableUploadOutcome) =>
          setItem(key, settledPatch(refusal, messageOf(refusal))),
        skip: (key: string) => setItem(key, SKIPPED_PATCH),
      };
      const { done, failed } = await runUploadQueue(keys, batchFiles.current, maxFiles, steps, signal);
      if (signal.aborted) return;
      // A failure may still have landed server-side (or the cap moved under us):
      // refresh so the card's count and dropzone match the ledger either way.
      if (done > 0 || failed > 0) router.refresh();
      toast({
        title: t('uploadedSummary', {
          done: formatNumber(done, locale),
          total: formatNumber(keys.length, locale),
        }),
        variant: done === 0 ? 'destructive' : undefined,
      });
    } finally {
      running.current = false;
      setUploading(false);
    }
  }

  function uploadMany(category: WorkingFileCategory, files: File[], maxFiles?: number): void {
    if (files.length === 0 || running.current) return;
    const batch = `${Date.now()}`;
    const items = files.map((file, index) => queuedItem(`${batch}-${index}`, file.name));
    batchFiles.current = new Map(items.map((item, index) => [item.key, { file: files[index], category }]));
    setQueue(items);
    void run(items.map((item) => item.key), maxFiles);
  }

  function retry(key: string, maxFiles?: number): void {
    if (running.current || !queue.some((item) => item.key === key && item.retryable)) return;
    void run([key], maxFiles);
  }

  function retryFailed(maxFiles?: number): void {
    const keys = queue.filter((item) => item.retryable).map((item) => item.key);
    if (running.current || keys.length === 0) return;
    void run(keys, maxFiles);
  }

  function download(fileId: string) {
    startDownload(async () => {
      const res = await getDeliverableUrl(fileId);
      if (res.ok && res.url) window.open(res.url, '_blank', 'noopener');
    });
  }

  return { pending: uploading || downloading, queue, uploadMany, retry, retryFailed, download };
}
