// ONE deliverable file through the upload path, as a plain async function (no
// React): friendly pre-flight (`validateDeliverableFile`) -> `createDeliverableUpload`
// (signed URL) -> PUT to Storage (bounded) -> `attachDeliverable` (records +
// attests the category's artifact). Moved verbatim out of `useDeliverableUpload`
// so a queue of files can run it one after another and report each outcome.
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
// the spinner stuck forever: the AbortController below aborts the PUT after this,
// and the file is reported as failed. 60s is generous headroom for the 100MB cap.
const UPLOAD_TIMEOUT_MS = 60_000;

export type DeliverableUploadOutcome =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'wrong_type' | 'put_failed' | ActionCode };

async function putToStorage(signedUrl: string, file: File): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const put = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type, 'x-upsert': 'true' },
      body: file,
      signal: controller.signal,
    });
    return put.ok;
  } catch {
    // Aborted by the deadline, or the network dropped.
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadDeliverableFile(
  engagementId: string,
  category: WorkingFileCategory,
  file: File,
): Promise<DeliverableUploadOutcome> {
  // Friendly client-side pre-flight before we ever request a signed URL.
  const localError = validateDeliverableFile(category, file.name, file.size);
  if (localError) {
    return { ok: false, reason: localError === 'file_too_large' ? 'too_large' : 'wrong_type' };
  }
  try {
    const signed = await createDeliverableUpload({
      engagementId,
      category,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if ('ok' in signed) return { ok: false, reason: (signed.error as ActionCode) ?? 'generic' };
    if (!(await putToStorage(signed.signedUrl, file))) return { ok: false, reason: 'put_failed' };
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
