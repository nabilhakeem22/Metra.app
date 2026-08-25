'use client';

import { useTranslations } from 'next-intl';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import {
  deriveWorkingFiles,
  type WorkingFileCategory,
} from '@/lib/engagements/working-files';

// Epic D, Slice 5 — the pinned "Working files" tray at the top of the cockpit's
// right rail. It shows the latest approved deliverable per working-file category
// (2D layout · render set · draft BOQ), derived purely from the artifacts the
// page already loaded (`deriveWorkingFiles`). Upload + signed-URL download are NOT
// wired this slice, so NO row is ever a live download: a category with no artifact
// OR an artifact with no attached file renders an honest, non-clickable
// "not yet available" affordance — never a broken link. Reskinned to the glass
// system as a FLAT (opaque `bg-card`, no backdrop-filter) right-rail panel with a
// brand-tinted category tile; logical CSS only (ms-auto / ps / pe) so the tray
// mirrors in ar-EG RTL. The version number uses plain interpolation (Western
// numerals in both locales).

/** Whether a category's file is downloaded or opened once wiring lands (cosmetic
 * now — every affordance is disabled until upload/signed-URL is built). */
const CATEGORY_ACTION: Record<WorkingFileCategory, 'download' | 'open'> = {
  layout: 'download',
  render: 'download',
  boq: 'open',
};

export function EngagementFilesTray({
  artifacts,
}: {
  artifacts: EngagementArtifactRecord[];
}) {
  const t = useTranslations('engagements.files');
  const rows = deriveWorkingFiles(artifacts);

  return (
    <section className="overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card text-[color:var(--text)] shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--rule)] px-4 py-3">
        <h3 className="m-0 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
          {t('title')}
        </h3>
        <span className="text-[11px] text-[color:var(--text-faint)]">
          {t('latestApproved')}
        </span>
      </header>
      <div className="grid gap-2 p-3">
        {rows.map((row) => {
          const hasArtifact = row.latest !== null;
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
                <div className="text-[11px] text-[color:var(--text-faint)]">
                  {hasArtifact
                    ? t('approvedMeta', { n: row.version })
                    : t('notAvailable')}
                </div>
              </div>
              <span
                className="ms-auto inline-flex shrink-0 cursor-not-allowed items-center gap-1 text-[12px] font-semibold text-[color:var(--text-faint)]"
                aria-disabled="true"
                title={t('notAvailable')}
              >
                <span aria-hidden>🔒</span>
                {hasArtifact ? t(CATEGORY_ACTION[row.category]) : t('notAvailable')}
                {hasArtifact && <span className="sr-only">{t('notAvailable')}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
