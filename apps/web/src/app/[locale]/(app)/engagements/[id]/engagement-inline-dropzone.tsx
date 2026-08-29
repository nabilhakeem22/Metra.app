'use client';

import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ChangeEvent } from 'react';
import { acceptFor } from '@/lib/engagements/deliverable-files';
import type { DesignState } from '@/lib/engagements/states';
import type { WorkingFileCategory } from '@/lib/engagements/working-files';
import { useDeliverableUpload } from './use-deliverable-upload';

// The command card's inline attachment dropzone — "THE ONE ACTION" when the
// studio's next move is to attach a deliverable. A single tap opens the picker;
// the file runs through the SAME shared upload hook the working-files tray uses
// (validate → signed URL → PUT → attach/attest → refresh), so recording the
// deliverable is what unblocks the stage (owner decision: no auto-advance).
// Logical CSS only (mirrors in ar-EG RTL); accept-list is the category's exact
// server-enforced extensions.

// State → working-file category the studio uploads at that stage (owner table):
//   layout / concept_review / negotiation → 2D layout
//   design_3d                             → render set
//   boq / shop_drawings                   → draft BOQ
// A state absent from the map has no inline dropzone (e.g. survey uses the
// toolbar so a non-off-plan measured survey isn't mistaken for a CAD import).
const STATE_DROPZONE_CATEGORY: Partial<Record<DesignState, WorkingFileCategory>> = {
  layout: 'layout',
  concept_review: 'layout',
  negotiation: 'layout',
  design_3d: 'render',
  boq: 'boq',
  shop_drawings: 'boq',
};

/** The inline-dropzone category for a state, or null when the stage has none. */
export function inlineDropzoneCategory(
  state: DesignState,
): WorkingFileCategory | null {
  return STATE_DROPZONE_CATEGORY[state] ?? null;
}

export function EngagementInlineDropzone({
  engagementId,
  category,
  canUpload,
}: {
  engagementId: string;
  category: WorkingFileCategory;
  canUpload: boolean;
}) {
  const t = useTranslations('engagements.files');
  const { pending, upload } = useDeliverableUpload(engagementId);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!canUpload) return null;

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
