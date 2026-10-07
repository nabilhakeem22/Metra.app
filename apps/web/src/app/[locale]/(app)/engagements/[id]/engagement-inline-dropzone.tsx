'use client';

import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { acceptFor } from '@/lib/engagements/deliverable-files';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { UploadQueueList } from './upload-queue-list';
import { useDeliverableUpload } from './use-deliverable-upload';

// The command card's inline attachment dropzone — "THE ONE ACTION" when the
// studio's next move is to attach a deliverable, and it says so in the stage's
// own words when the card passes a `label`. A tap opens the picker (several
// files at once), or files can be DROPPED on it; they run one after another
// through the SAME shared upload hook the working-files tray uses (validate →
// signed URL → PUT → attach/attest → refresh), each with its status listed
// underneath. Recording the deliverable is what unblocks the stage (owner
// decision: no auto-advance). The button stays the keyboard path.
// Logical CSS only (mirrors in ar-EG RTL); accept-list is the category's exact
// server-enforced extensions. The state → category table itself is DATA, not UI:
// it lives in the pure lib/engagements/inline-dropzone-category.ts leaf.

export function EngagementInlineDropzone({
  engagementId,
  category,
  canUpload,
  atCapacity = false,
  maxFiles,
  label,
}: {
  engagementId: string;
  category: WorkingFileCategory;
  canUpload: boolean;
  /** This category already holds every file its guard will accept. */
  atCapacity?: boolean;
  /** How many more files this category may take (concept options); undefined = no cap. */
  maxFiles?: number;
  /**
   * The stage's act, in its own words -- "Attach the concept layouts". When the
   * card knows what this upload IS, the button says that instead of naming a file
   * category, and the headline above it and the control below it become one
   * sentence rather than two descriptions of the same move. Falls back to the
   * generic "Upload - <category>" when no act is known.
   */
  label?: string;
}) {
  const t = useTranslations('engagements.files');
  const { pending, queue, uploadMany, retry, retryFailed } = useDeliverableUpload(engagementId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  if (!canUpload) return null;

  // Concept options are APPEND-ONLY (recording one attests it; there is no delete
  // path) and `optionsReady` accepts at most four, so a fifth upload would strand
  // the engagement in a state it cannot leave. At the cap the affordance is
  // REMOVED and replaced with copy that says why — never a dead button the studio
  // can keep pressing into an unrecoverable state.
  if (atCapacity) {
    return (
      <div
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-item border border-dashed border-[color:var(--rule)] bg-[color:var(--track)] px-4 py-5 text-small font-semibold text-[color:var(--text-muted)]"
        aria-disabled="true"
      >
        <span>{t('conceptOptionCap')}</span>
      </div>
    );
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Clear the input (the Files are captured) so re-picking the same file fires.
    event.target.value = '';
    uploadMany(category, files, maxFiles);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!pending) setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (pending) return;
    uploadMany(category, Array.from(event.dataTransfer.files), maxFiles);
  }

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={acceptFor(category)}
        onChange={onPick}
        disabled={pending}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        disabled={pending}
        data-dragging={dragging || undefined}
        className={`flex w-full items-center justify-center gap-2 rounded-item border border-[color:var(--brand-tint-border)] px-4 py-5 text-small font-semibold text-brand-ink transition-colors hover:bg-[color:var(--track)] disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging ? 'border-solid bg-[color:var(--track)]' : 'border-dashed bg-brand-tint'
        }`}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="size-4" aria-hidden />
        )}
        <span>
          {pending
            ? t('uploading')
            : dragging
              ? t('dropHere')
              : (label ?? `${t('upload')} · ${t(`category.${category}`)}`)}
        </span>
      </button>
      <UploadQueueList
        queue={queue}
        pending={pending}
        onRetry={(key) => retry(key, maxFiles)}
        onRetryFailed={() => retryFailed(maxFiles)}
      />
    </div>
  );
}
