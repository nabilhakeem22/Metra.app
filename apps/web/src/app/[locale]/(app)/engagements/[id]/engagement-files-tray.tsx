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
import { ArtifactVisibilityControl } from './artifact-visibility-control';
import { useClientVisibility } from './use-client-visibility';
import { UploadQueueList } from './upload-queue-list';
import { useDeliverableUpload } from './use-deliverable-upload';
import { SectionLabel } from '@/components/ui/section-label';

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

/** Whether a category's file is downloaded or opened. `shopDrawing`,
 *  `conceptOption` and `survey` are upload-only categories with no pinned tray
 *  slot, but the total Record keeps this map from drifting if any gains one. */
const CATEGORY_ACTION: Record<WorkingFileCategory, 'download' | 'open'> = {
  layout: 'download',
  render: 'download',
  boq: 'open',
  shopDrawing: 'download',
  conceptOption: 'download',
  survey: 'download',
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
  const { pending, queue, uploadMany, download } = useDeliverableUpload(engagementId);
  // Client Deliverables, Step 1. `canUpload` is the §2.2 engagements_design/create
  // cell; for THIS capability the create and update cells are identical for all
  // seven roles (only `viewer` is read-only), so it is also the right gate for the
  // visibility toggle. The server action re-checks update regardless — a hidden
  // control is never the gate.
  const visibility = useClientVisibility();
  const inputRefs = useRef<
    Partial<Record<WorkingFileCategory, HTMLInputElement | null>>
  >({});
  const rows = deriveWorkingFiles(artifacts);

  function onPick(category: WorkingFileCategory, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Clear the input immediately (the Files are captured) so re-picking the same
    // file still fires a change; the shared hook owns validation + the uploads.
    event.target.value = '';
    uploadMany(category, files);
  }

  return (
    <section className="overflow-hidden rounded-panel border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--rule)] px-4 py-3">
        <SectionLabel as="h3" className="m-0">
          {t('title')}
        </SectionLabel>
        <span className="text-caption text-[color:var(--text-muted)]">
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
              className="flex items-center gap-[11px] rounded-item border border-[color:var(--rule)] bg-card px-3 py-2.5"
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-item bg-brand-tint text-small font-semibold text-brand-ink ltr:font-mono">
                {t(`badge.${row.category}`)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-small font-semibold">{name}</div>
                <div className="text-caption text-[color:var(--text-muted)]">
                  {hasArtifact
                    ? t('approvedMeta', { n: row.version })
                    : t('notAvailable')}
                </div>
              </div>

              <div className="ms-auto inline-flex shrink-0 flex-wrap items-center justify-end gap-1">
                {fileId && row.latest && (
                  <ArtifactVisibilityControl
                    artifactId={row.latest.id}
                    clientVisible={row.latest.clientVisible}
                    canManage={canUpload}
                    visibility={visibility}
                  />
                )}

                {fileId && (
                  <button
                    type="button"
                    onClick={() => download(fileId)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-item px-2 py-1 text-caption font-semibold text-brand-ink hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
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
                      multiple
                      className="hidden"
                      accept={acceptFor(row.category)}
                      onChange={(event) => onPick(row.category, event)}
                      disabled={pending}
                    />
                    <button
                      type="button"
                      onClick={() => inputRefs.current[row.category]?.click()}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded-item px-2 py-1 text-caption font-semibold text-[color:var(--text-muted)] hover:bg-brand-tint hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-60"
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
                      className="inline-flex items-center gap-1 cursor-not-allowed text-caption font-semibold text-[color:var(--text-faint)]"
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
      {queue.length > 0 && (
        <div className="border-t border-[color:var(--rule)] px-4 py-2">
          <UploadQueueList queue={queue} />
        </div>
      )}
    </section>
  );
}
