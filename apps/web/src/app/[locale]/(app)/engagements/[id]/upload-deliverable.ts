// ONE deliverable file through the upload path, as a plain async function (no
// React): friendly pre-flight (`validateDeliverableFile`) -> a signed URL on a
// `files` row -> PUT to Storage (stall-bounded, with progress) -> `attachDeliverable`
// (records + attests the category's artifact). A queue runs it file after file.
//
// A RETRY RESUMES where the attempt broke (`resume`): a failed PUT asks for a new
// URL on the SAME files row (no orphan row per attempt), and an attach whose
// answer was lost is sent again with the same file, which the server answers
// with the artifact it may already have recorded (never a second one).
// It never throws: every failure is an outcome the queue shows next to the file.
// It never advances the delivery (owner rule: no auto-advance after uploads).
import type { ActionCode } from '@/lib/actions/result';
import {
  attachDeliverable,
  createDeliverableUpload,
  renewDeliverableUpload,
} from '@/lib/engagements/actions';
import { validateDeliverableFile } from '@/lib/engagements/deliverable-files';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { putToStorage, type UploadProgressListener } from './put-to-storage';

/** Where a broken attempt can pick up: its files row, and the step that broke. */
export interface UploadResume {
  fileId: string;
  stage: 'put' | 'attach';
}

export type DeliverableUploadOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'too_large' | 'wrong_type' | 'put_failed' | 'aborted' | ActionCode;
      resume?: UploadResume;
    };

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
  options: { onProgress?: UploadProgressListener; signal?: AbortSignal; resume?: UploadResume } = {},
): Promise<DeliverableUploadOutcome> {
  const refusal = preflightRefusal(category, file);
  if (refusal) return refusal;
  let fileId = options.resume?.fileId;
  let stage: 'sign' | 'put' | 'attach' = options.resume?.stage ?? 'sign';
  try {
    if (stage !== 'attach') {
      const signed = fileId
        ? await renewDeliverableUpload({ engagementId, fileId })
        : await createDeliverableUpload({
            engagementId,
            category,
            originalName: file.name,
            contentType: file.type,
            sizeBytes: file.size,
          });
      if ('ok' in signed) return { ok: false, reason: (signed.error as ActionCode) ?? 'generic' };
      fileId = signed.fileId;
      stage = 'put';
      const put = await putToStorage(signed.signedUrl, file, options);
      if (put === 'aborted') return { ok: false, reason: 'aborted' };
      if (put === 'failed') return { ok: false, reason: 'put_failed', resume: { fileId, stage } };
    }
    stage = 'attach';
    const attached = await attachDeliverable({ engagementId, category, fileId: fileId!, label: file.name });
    if (!attached.ok) return { ok: false, reason: (attached.error as ActionCode) ?? 'generic' };
    return { ok: true };
  } catch {
    // A server action that rejected (transport) rather than answering: resume
    // from the step it was on, with the row it already has.
    const resume = fileId && stage !== 'sign' ? { fileId, stage } : undefined;
    return { ok: false, reason: 'generic', resume };
  }
}
