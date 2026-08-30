'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { ArtifactVisibilityControl } from './artifact-visibility-control';
import { Empty, HEAD_ROW } from './engagement-panels-parts';
import { useClientVisibility } from './use-client-visibility';

/**
 * The full artifact record. Client Deliverables, Step 1 adds the client-portal
 * visibility column: every FILE-BEARING artifact shows whether the client can see
 * it and (for a caller who may change it) the show/hide toggle. An artifact with no
 * attached file shows a dash — there would be nothing for the client to download,
 * and the server refuses to mark it visible.
 */
export function ArtifactsPanel({
  artifacts,
  canManageVisibility,
}: {
  artifacts: EngagementArtifactRecord[];
  canManageVisibility: boolean;
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const visibility = useClientVisibility();
  if (artifacts.length === 0) return <Empty text={t('artifacts.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-start font-medium">{t('artifacts.kind')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.label')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.attestedAt')}</th>
          <th className="py-2 text-start font-medium">
            {t('files.visibility.visible')}
          </th>
        </tr>
      </thead>
      <tbody>
        {artifacts.map((a) => (
          <tr key={a.id} className="border-b border-[color:var(--rule)] last:border-0">
            <td className="py-2">{t(`artifactKind.${a.kind}`)}</td>
            <td className="py-2 text-[color:var(--text-muted)]">{a.label || '—'}</td>
            <td className="py-2 text-[color:var(--text-muted)]" dir="ltr">
              {formatDate(a.attestedAt, locale)}
            </td>
            <td className="py-2">
              {a.fileId ? (
                <ArtifactVisibilityControl
                  artifactId={a.id}
                  clientVisible={a.clientVisible}
                  canManage={canManageVisibility}
                  visibility={visibility}
                />
              ) : (
                <span className="text-[color:var(--text-muted)]">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
