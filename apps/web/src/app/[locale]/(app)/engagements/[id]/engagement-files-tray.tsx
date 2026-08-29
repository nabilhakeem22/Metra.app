'use client';

import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type ChangeEvent } from 'react';
import { acceptFor } from '@/lib/engagements/deliverable-files';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import {
  deriveWorkingFiles,
  type WorkingFileCategory,
} from '@/lib/engagements/working-files';
import { useDeliverableUpload } from './use-deliverable-upload';

// Epic D, Slice 5 + Deliverable Uploads — the "Working files" tray, now pinned at
// the top of the Files detail tab. It shows the latest approved deliverable per
// category (2D layout · render set · draft BOQ), derived purely from the
// artifacts the page already loaded (`deriveWorkingFiles`). The upload/download
// flow is the shared `useDeliverableUpload` hook (same path as the command-card
// inline dropzone — no behaviour change). When the caller may
// upload (`canUpload`), each slot exposes a hidden file picker + an Upload
// affordance; a slot with a file also exposes a Download/Open affordance that
// mints a short-lived signed URL. When the caller cannot upload and no file
// exists, the slot renders an honest, non-clickable "not yet available" lock —
// never a broken link. Glass FLAT panel; logical CSS only (ms-auto / ps / pe) so
// the tray mirrors in ar-EG RTL. Version numbers use plain interpolation
// (Western numerals in both locales).

/** Whether a category's file is downloaded or opened. */
const CATEGORY_ACTION: Record<WorkingFileCategory, 'download' | 'open'> = {
  layout: 'download',
  render: 'download',
  boq: 'open',
};

export function EngagementFilesTray({
  artifacts,
  engagementId,
  canUpload,
}: {
  artifacts: EngagementArtifactRecord[];
  engagementId: string;
  canUpload: boolean;
}) {
  const t = useTranslations('engagements.files');
  const { pending, upload, download } = useDeliverableUpload(engagementId);
  const inputRefs = useRef<
    Partial<Record<WorkingFileCategory, HTMLInputElement | null>>
  >({});
  const rows = deriveWorkingFiles(artifacts);

  function onPick(category: WorkingFileCategory, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the input immediately (the File is captured) so re-picking the same
    // file still fires a change; the shared hook owns validation + the upload.
    event.target.value = '';
    if (file) upload(category, file);
  }

  return (
    <section className="overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--rule)] px-4 py-3">
        <h3 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
          {t('title')}
        </h3>
        <span className="text-[11px] text-[color:var(--text-muted)]">
          {t('latestApproved')}
        </span>
      </header>
      <div className="grid gap-2 p-3">
        {rows.map((row) => {
          const hasArtifact = row.latest !== null;
          const fileId = row.latest?.fileId ?? null;
          const name = hasArtifact
            ? row.latest?.label?.trim() || t(`category.${row.category}`)
            : t(`category.${row.category}`);
          return (
            <div
              key={row.category}
              className="flex items-center gap-[11px] rounded-[var(--r-item)] border border-[color:var(--rule)] bg-card px-3 py-2.5"
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[var(--r-icon)] bg-brand-tint font-mono text-[13px] font-semibold text-brand-ink">
                {t(`badge.${row.category}`)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{name}</div>
                <div className="text-[11px] text-[color:var(--text-muted)]">
                  {hasArtifact
                    ? t('approvedMeta', { n: row.version })
                    : t('notAvailable')}
                </div>
              </div>

              <div className="ms-auto inline-flex shrink-0 items-center gap-1">
                {fileId && (
                  <button
                    type="button"
                    onClick={() => download(fileId)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-[var(--r-icon)] px-2 py-1 text-[12px] font-semibold text-brand-ink hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download className="size-3.5" aria-hidden />
                    {t(CATEGORY_ACTION[row.category])}
                  </button>
                )}

                {canUpload ? (
                  <>
                    <input
                      ref={(el) => {
                        inputRefs.current[row.category] = el;
                      }}
                      type="file"
                      className="hidden"
                      accept={acceptFor(row.category)}
                      onChange={(event) => onPick(row.category, event)}
                      disabled={pending}
                    />
                    <button
                      type="button"
                      onClick={() => inputRefs.current[row.category]?.click()}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded-[var(--r-icon)] px-2 py-1 text-[12px] font-semibold text-[color:var(--text-muted)] hover:bg-brand-tint hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pending ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Upload className="size-3.5" aria-hidden />
                      )}
                      {pending ? t('uploading') : t('upload')}
                    </button>
                  </>
                ) : (
                  !fileId && (
                    <span
                      className="inline-flex items-center gap-1 cursor-not-allowed text-[12px] font-semibold text-[color:var(--text-faint)]"
                      aria-disabled="true"
                      title={t('notAvailable')}
                    >
                      <span aria-hidden>🔒</span>
                      {t('notAvailable')}
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
