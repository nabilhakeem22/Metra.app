'use client';

import { Download, Loader2, Upload } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import type { ChangeEvent } from 'react';
import { acceptFor } from '@/lib/engagements/deliverable-files';
import type {
  WorkingFileCategory,
  WorkingFileRow,
} from '@/lib/engagements/working-files';
import { ArtifactVisibilityControl } from './artifact-visibility-control';
import type { useClientVisibility } from './use-client-visibility';

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

/**
 * One slot of the working-files tray: the category badge, the file name and
 * version line, then the visibility pill, the Download/Open button and the
 * hidden file picker with its Upload button (or the honest "not yet available"
 * lock). The parent owns the upload hook, the visibility hook and the input
 * refs; it passes the handlers down already bound to this row's category.
 */
export function EngagementFilesTrayRow({
  row,
  t,
  canUpload,
  visibility,
  pending,
  onDownload,
  onPick,
  registerInput,
  openPicker,
}: {
  row: WorkingFileRow;
  t: ReturnType<typeof useTranslations<'engagements.files'>>;
  canUpload: boolean;
  visibility: ReturnType<typeof useClientVisibility>;
  pending: boolean;
  onDownload: (fileId: string) => void;
  onPick: (
    category: WorkingFileCategory,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
  registerInput: (el: HTMLInputElement | null) => void;
  openPicker: () => void;
}) {
  const hasArtifact = row.latest !== null;
  const fileId = row.latest?.fileId ?? null;
  const name = hasArtifact
    ? row.latest?.label?.trim() || t(`category.${row.category}`)
    : t(`category.${row.category}`);
  return (
    <div className="flex items-center gap-[11px] rounded-item border border-[color:var(--rule)] bg-card px-3 py-2.5">
      {/* The badge grows with its word ("المقايسة" is wider than "2D"), up to a
          cap past which it truncates and names the category on hover, so it
          never runs under the title beside it. */}
      <span
        title={t(`category.${row.category}`)}
        className="inline-flex h-[30px] min-w-[30px] max-w-24 shrink-0 items-center justify-center rounded-item bg-brand-tint px-1.5 text-small font-semibold text-brand-ink ltr:font-mono"
      >
        <span className="truncate">{t(`badge.${row.category}`)}</span>
      </span>
      <div className="min-w-0">
        <div className="truncate text-small font-semibold">{name}</div>
        <div className="text-caption text-[color:var(--text-muted)]">
          {hasArtifact ? t('approvedMeta', { n: row.version }) : t('notAvailable')}
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
            onClick={() => onDownload(fileId)}
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
              ref={registerInput}
              type="file"
              multiple
              className="hidden"
              accept={acceptFor(row.category)}
              onChange={(event) => onPick(row.category, event)}
              disabled={pending}
            />
            <button
              type="button"
              onClick={openPicker}
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
}
