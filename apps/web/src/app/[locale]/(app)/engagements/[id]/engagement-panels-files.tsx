'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import { ArtifactPanel } from './engagement-artifact-panel';
import { EngagementFilesTray } from './engagement-files-tray';
import { PanelHeader } from './engagement-panel-header';
import { ArtifactsPanel } from './engagement-panels-artifacts';

/**
 * The Files detail tab: the working-files tray (latest approved deliverable per
 * category, with upload/download) over the full artifact record.
 *
 * The header is where the product finally SAYS what it has always modelled —
 * that uploading a working file and recording an attested deliverable are two
 * different acts. The tray owns the first; "Add a deliverable" owns the second,
 * and it used to sit in a strip under the command card looking identical to
 * "log a payment". Same two acts, one shelf, visibly distinct.
 */
export function FilesTab({
  engagementId,
  artifacts,
  canUpload,
  canRecordArtifact,
  pending,
  runAction,
}: {
  engagementId: string;
  artifacts: EngagementArtifactRecord[];
  canUpload: boolean;
  canRecordArtifact: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div>
      <PanelHeader
        title={tp('files')}
        sub={tpa('filesSub')}
        actions={
          canRecordArtifact && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => setAddOpen((open) => !open)}
              aria-expanded={addOpen}
            >
              <FileUp className="size-4" aria-hidden />
              {tpa('addDeliverable')}
            </Button>
          )
        }
      />
      <div className="space-y-5 p-4">
        {addOpen && (
          <ArtifactPanel
            engagementId={engagementId}
            pending={pending}
            runAction={runAction}
            onDone={() => setAddOpen(false)}
          />
        )}
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
    </div>
  );
}
