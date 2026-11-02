'use client';

import { useTranslations } from 'next-intl';
import { useRef, type ChangeEvent } from 'react';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import {
  deriveWorkingFiles,
  type WorkingFileCategory,
} from '@/lib/engagements/working-files';
import { EngagementFilesTrayRow } from './engagement-files-tray-row';
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
  const { pending, queue, uploadMany, retry, retryFailed, download } =
    useDeliverableUpload(engagementId);
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
        {rows.map((row) => (
          <EngagementFilesTrayRow
            key={row.category}
            row={row}
            t={t}
            canUpload={canUpload}
            visibility={visibility}
            pending={pending}
            onDownload={download}
            onPick={onPick}
            registerInput={(el) => {
              inputRefs.current[row.category] = el;
            }}
            openPicker={() => inputRefs.current[row.category]?.click()}
          />
        ))}
      </div>
      {queue.length > 0 && (
        <div className="border-t border-[color:var(--rule)] px-4 py-2">
          <UploadQueueList
            queue={queue}
            pending={pending}
            onRetry={(key) => retry(key)}
            onRetryFailed={() => retryFailed()}
          />
        </div>
      )}
    </section>
  );
}
