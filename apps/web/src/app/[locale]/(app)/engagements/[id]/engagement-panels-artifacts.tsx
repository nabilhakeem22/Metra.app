'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EngagementArtifactRecord } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { Empty, HEAD_ROW } from './engagement-panels-parts';

export function ArtifactsPanel({ artifacts }: { artifacts: EngagementArtifactRecord[] }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  if (artifacts.length === 0) return <Empty text={t('artifacts.empty')} />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={HEAD_ROW}>
          <th className="py-2 text-start font-medium">{t('artifacts.kind')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.label')}</th>
          <th className="py-2 text-start font-medium">{t('artifacts.attestedAt')}</th>
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
