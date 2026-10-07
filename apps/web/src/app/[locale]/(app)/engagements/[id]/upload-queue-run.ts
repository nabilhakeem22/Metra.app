// The upload queue's ORDER and CAP rule, without React: files go one after
// another, and only a file that actually LANDS takes one of the capped slots. A
// refused or failed file leaves its slot for the next one, so "limit reached" is
// said only once the cap really is. The hook supplies what each step does to the
// rows; this file decides which step each file gets.
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import {
  preflightRefusal,
  type DeliverableUploadOutcome,
  type UploadResume,
} from './upload-deliverable';

export interface QueuedFile {
  file: File;
  category: WorkingFileCategory;
  /** Where its last attempt broke, so a retry picks up there. */
  resume?: UploadResume;
}

export interface UploadQueueSteps {
  /** Upload one file; true when it landed. */
  upload: (key: string, queued: QueuedFile) => Promise<boolean>;
  /** The pre-flight refused the file. */
  refuse: (key: string, refusal: DeliverableUploadOutcome) => void;
  /** The cap is reached: the file is not sent. */
  skip: (key: string) => void;
}

export async function runUploadQueue(
  keys: readonly string[],
  files: ReadonlyMap<string, QueuedFile>,
  maxFiles: number | undefined,
  steps: UploadQueueSteps,
  signal?: AbortSignal,
): Promise<{ done: number; failed: number }> {
  let slotsLeft = maxFiles ?? Number.POSITIVE_INFINITY;
  let done = 0;
  let failed = 0;
  for (const key of keys) {
    if (signal?.aborted) break;
    const queued = files.get(key);
    if (!queued) continue;
    const refusal = preflightRefusal(queued.category, queued.file);
    if (refusal) {
      failed += 1;
      steps.refuse(key, refusal);
    } else if (slotsLeft <= 0) {
      steps.skip(key);
    } else if (await steps.upload(key, queued)) {
      done += 1;
      slotsLeft -= 1;
    } else {
      failed += 1;
    }
  }
  return { done, failed };
}
