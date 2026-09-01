'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Fragment } from 'react';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { ArtifactVisibilityControl } from './artifact-visibility-control';
import { DocumentThreadPanel } from './document-thread-panel';
import { Empty, HEAD_ROW } from './engagement-panels-parts';
import { useClientVisibility } from './use-client-visibility';

/**
 * The full artifact record. Client Deliverables, Step 1 adds the client-portal
 * visibility column: every FILE-BEARING artifact shows whether the client can see
 * it and (for a caller who may change it) the show/hide toggle. An artifact with no
 * attached file shows a dash — there would be nothing for the client to download,
 * and the server refuses to mark it visible.
 *
 * Step 2 adds the per-document comment thread, on its own full-width row UNDER each
 * artifact rather than in a fourth column — a conversation does not fit in a table
 * cell, and pushing it below keeps the scannable row scannable. The thread is lazy;
 * only file-bearing artifacts get one, since a thread about a document the client
 * cannot receive has nobody on the other end.
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
          <Fragment key={a.id}>
            {/* The rule sits under the THREAD row when there is one, so a document
                and its conversation read as a single block. */}
            <tr className={a.fileId ? '' : 'border-b border-[color:var(--rule)]'}>
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
            {a.fileId && (
              <tr className="border-b border-[color:var(--rule)] last:border-0">
                <td colSpan={4} className="pb-3">
                  <DocumentThreadPanel
                    artifactId={a.id}
                    canReply={canManageVisibility}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
