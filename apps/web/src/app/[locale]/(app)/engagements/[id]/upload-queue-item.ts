// One row of the deliverable upload queue, and the pure rules that move it from
// state to state. No React: the hook owns WHEN a row changes, this file owns WHAT
// it changes to.
import type { DeliverableUploadOutcome } from './upload-deliverable';

export interface UploadQueueItem {
  key: string;
  name: string;
  status: 'queued' | 'uploading' | 'done' | 'failed' | 'skipped';
  /** Why a file failed, localized; null otherwise. */
  message: string | null;
  /** 0..100 while uploading, else null. */
  progress: number | null;
  /** True only for a failed TRANSFER, which may succeed when tried again. */
  retryable: boolean;
}

export function queuedItem(key: string, name: string): UploadQueueItem {
  return { key, name, status: 'queued', message: null, progress: null, retryable: false };
}

export const UPLOADING_PATCH: Partial<UploadQueueItem> = {
  status: 'uploading',
  message: null,
  progress: 0,
  retryable: false,
};

export const SKIPPED_PATCH: Partial<UploadQueueItem> = {
  status: 'skipped',
  message: null,
  progress: null,
  retryable: false,
};

/**
 * A broken transfer (the Storage PUT, or a server action that never answered) is
 * worth a retry. A refusal (wrong type, too large, a coded server answer) would
 * only be refused again, so it offers none.
 */
export function isRetryableOutcome(outcome: DeliverableUploadOutcome): boolean {
  return !outcome.ok && (outcome.reason === 'put_failed' || outcome.reason === 'generic');
}

/** The row once its upload has answered. */
export function settledPatch(
  outcome: DeliverableUploadOutcome,
  message: string | null,
): Partial<UploadQueueItem> {
  return {
    status: outcome.ok ? 'done' : 'failed',
    message,
    progress: null,
    retryable: isRetryableOutcome(outcome),
  };
}
