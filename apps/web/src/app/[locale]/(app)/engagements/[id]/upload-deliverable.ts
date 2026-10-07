// ONE deliverable file through the upload path, as a plain async function (no
// React): friendly pre-flight (`validateDeliverableFile`) -> `createDeliverableUpload`
// (signed URL) -> PUT to Storage (bounded, with progress) -> `attachDeliverable`
// (records + attests the category's artifact). A queue of files runs it one after
// another and reports each outcome; a retry runs it again for one file.
// It never throws: every failure is an outcome the queue shows next to the file.
// It never advances the delivery (owner rule: no auto-advance after uploads).
import type { ActionCode } from '@/lib/actions/result';
import {
  attachDeliverable,
  createDeliverableUpload,
} from '@/lib/engagements/actions';
import { validateDeliverableFile } from '@/lib/engagements/deliverable-files';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';

// Storage PUT deadline. A hung upload (dead Storage / lost network) must not leave
// the spinner stuck forever: the request's own timeout ends the PUT after this,
// and the file is reported as failed. 60s is generous headroom for the 100MB cap.
export const UPLOAD_TIMEOUT_MS = 60_000;

export type DeliverableUploadOutcome =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'wrong_type' | 'put_failed' | ActionCode };

/** Whole percent of the file sent so far, 0..100. */
export type UploadProgressListener = (percent: number) => void;

/**
 * PUT the file to its signed URL through XMLHttpRequest, the one browser API that
 * reports upload progress. Resolves true on a 2xx; false on any HTTP error,
 * network drop, abort or the deadline. The listener hears each whole percent once.
 */
function putToStorage(
  signedUrl: string,
  file: File,
  onProgress?: UploadProgressListener,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    let lastPercent = -1;
    const fail = () => resolve(false);
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = fail;
    request.onabort = fail;
    request.ontimeout = fail;
    request.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      if (percent === lastPercent) return;
      lastPercent = percent;
      onProgress(percent);
    };
    try {
      request.open('PUT', signedUrl);
      request.timeout = UPLOAD_TIMEOUT_MS;
      request.setRequestHeader('content-type', file.type);
      request.setRequestHeader('x-upsert', 'true');
      request.send(file);
    } catch {
      // A malformed URL or a refused header: the same outcome as a dropped network.
      fail();
    }
  });
}

/** The friendly client-side pre-flight: a refusal before any signed URL, or null. */
export function preflightRefusal(
  category: WorkingFileCategory,
  file: File,
): DeliverableUploadOutcome | null {
  const localError = validateDeliverableFile(category, file.name, file.size);
  if (!localError) return null;
  return { ok: false, reason: localError === 'file_too_large' ? 'too_large' : 'wrong_type' };
}

export async function uploadDeliverableFile(
  engagementId: string,
  category: WorkingFileCategory,
  file: File,
  onProgress?: UploadProgressListener,
): Promise<DeliverableUploadOutcome> {
  const refusal = preflightRefusal(category, file);
  if (refusal) return refusal;
  try {
    const signed = await createDeliverableUpload({
      engagementId,
      category,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if ('ok' in signed) return { ok: false, reason: (signed.error as ActionCode) ?? 'generic' };
    if (!(await putToStorage(signed.signedUrl, file, onProgress))) {
      return { ok: false, reason: 'put_failed' };
    }
    const attached = await attachDeliverable({
      engagementId,
      category,
      fileId: signed.fileId,
      label: file.name,
    });
    if (!attached.ok) return { ok: false, reason: (attached.error as ActionCode) ?? 'generic' };
    return { ok: true };
  } catch {
    // A server action that rejected (transport) rather than answering.
    return { ok: false, reason: 'generic' };
  }
}
