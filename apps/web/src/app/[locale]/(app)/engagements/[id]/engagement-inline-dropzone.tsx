'use client';

import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ChangeEvent } from 'react';
import { acceptFor } from '@/lib/engagements/deliverable-files';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { useDeliverableUpload } from './use-deliverable-upload';

// The command card's inline attachment dropzone — "THE ONE ACTION" when the
// studio's next move is to attach a deliverable. A single tap opens the picker;
// the file runs through the SAME shared upload hook the working-files tray uses
// (validate → signed URL → PUT → attach/attest → refresh), so recording the
// deliverable is what unblocks the stage (owner decision: no auto-advance).
// Logical CSS only (mirrors in ar-EG RTL); accept-list is the category's exact
// server-enforced extensions. The state → category table itself is DATA, not UI:
// it lives in the pure lib/engagements/inline-dropzone-category.ts leaf.

export function EngagementInlineDropzone({
  engagementId,
  category,
  canUpload,
  atCapacity = false,
}: {
  engagementId: string;
  category: WorkingFileCategory;
  canUpload: boolean;
  /** This category already holds every file its guard will accept. */
  atCapacity?: boolean;
}) {
  const t = useTranslations('engagements.files');
  const { pending, upload } = useDeliverableUpload(engagementId);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!canUpload) return null;

  // Concept options are APPEND-ONLY (recording one attests it; there is no delete
  // path) and `optionsReady` accepts at most four, so a fifth upload would strand
  // the engagement in a state it cannot leave. At the cap the affordance is
  // REMOVED and replaced with copy that says why — never a dead button the studio
  // can keep pressing into an unrecoverable state.
  if (atCapacity) {
    return (
      <div
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-[var(--r-item)] border border-dashed border-[color:var(--rule)] bg-[color:var(--track)] px-4 py-5 text-[13px] font-semibold text-[color:var(--text-muted)]"
        aria-disabled="true"
      >
        <span>{t('conceptOptionCap')}</span>
      </div>
    );
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) upload(category, file);
  }

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={acceptFor(category)}
        onChange={onPick}
        disabled={pending}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--r-item)] border border-dashed border-[color:var(--brand-tint-border)] bg-brand-tint px-4 py-5 text-[13px] font-semibold text-brand-ink transition-colors hover:bg-[color:var(--track)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="size-4" aria-hidden />
        )}
        <span>
          {pending ? t('uploading') : t('upload')} · {t(`category.${category}`)}
        </span>
      </button>
    </div>
  );
}
