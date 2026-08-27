'use client';

import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useTransition, type ChangeEvent } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  attachDeliverable,
  createDeliverableUpload,
  getDeliverableUrl,
} from '@/lib/engagements/actions';
import {
  ALLOWED_EXTENSIONS,
  validateDeliverableFile,
} from '@/lib/engagements/deliverable-files';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import {
  deriveWorkingFiles,
  type WorkingFileCategory,
} from '@/lib/engagements/working-files';

// Epic D, Slice 5 + Deliverable Uploads — the pinned "Working files" tray at the
// top of the cockpit's right rail. It shows the latest approved deliverable per
// category (2D layout · render set · draft BOQ), derived purely from the
// artifacts the page already loaded (`deriveWorkingFiles`). When the caller may
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

/** The picker's `accept` list for a category (dot-prefixed extensions). */
function acceptFor(category: WorkingFileCategory): string {
  return ALLOWED_EXTENSIONS[category].map((ext) => `.${ext}`).join(',');
}

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
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRefs = useRef<
    Partial<Record<WorkingFileCategory, HTMLInputElement | null>>
  >({});
  const rows = deriveWorkingFiles(artifacts);

  function clearInput(category: WorkingFileCategory) {
    const input = inputRefs.current[category];
    if (input) input.value = '';
  }

  function onPick(category: WorkingFileCategory, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Friendly client-side pre-flight before we ever request a signed URL.
    const localError = validateDeliverableFile(category, file.name, file.size);
    if (localError) {
      toast({
        title: localError === 'file_too_large' ? t('tooLarge') : t('wrongType'),
        variant: 'destructive',
      });
      clearInput(category);
      return;
    }

    startTransition(async () => {
      try {
        const signed = await createDeliverableUpload({
          engagementId,
          category,
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        if ('ok' in signed) {
          toast({
            title: resolveActionError(signed.error as ActionCode, te),
            variant: 'destructive',
          });
          return;
        }
        const put = await fetch(signed.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type, 'x-upsert': 'true' },
          body: file,
        });
        if (!put.ok) throw new Error('put_failed');
        const attached = await attachDeliverable({
          engagementId,
          category,
          fileId: signed.fileId,
          label: file.name,
        });
        if (!attached.ok) {
          toast({
            title: resolveActionError(attached.error as ActionCode, te),
            variant: 'destructive',
          });
          return;
        }
        toast({ title: t('uploaded') });
        router.refresh();
      } catch {
        toast({ title: te('generic'), variant: 'destructive' });
      } finally {
        clearInput(category);
      }
    });
  }

  function onDownload(fileId: string) {
    startTransition(async () => {
      const res = await getDeliverableUrl(fileId);
      if (res.ok && res.url) window.open(res.url, '_blank', 'noopener');
    });
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
                    onClick={() => onDownload(fileId)}
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
