'use client';

import { useTranslations } from 'next-intl';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import { ArtifactsPanel } from './engagement-panels-artifacts';
import { EngagementFilesTray } from './engagement-files-tray';

// The Files detail tab: the "Working files" tray (latest approved deliverable per
// category, with upload/download) over the full artifact record below it. Both
// read data the page already loaded; the tray owns the upload flow (shared hook).
// Pure composition — logical CSS only so it mirrors in ar-EG RTL.
export function FilesTab({
  engagementId,
  artifacts,
  canUpload,
}: {
  engagementId: string;
  artifacts: EngagementArtifactRecord[];
  canUpload: boolean;
}) {
  const t = useTranslations('engagements');
  return (
    <div className="space-y-5">
      <EngagementFilesTray
        artifacts={artifacts}
        engagementId={engagementId}
        canUpload={canUpload}
      />
      <div>
        <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
          {t('panels.artifacts')}
        </p>
        {/* `canUpload` is the §2.2 engagements_design/create cell; for THIS
            capability create and update are identical across all seven roles (only
            `viewer` is read-only), so it is also the right gate for the client-portal
            visibility toggle. The server action re-checks update regardless. */}
        <ArtifactsPanel artifacts={artifacts} canManageVisibility={canUpload} />
      </div>
    </div>
  );
}
