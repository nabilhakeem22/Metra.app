'use client';

import { useTranslations } from 'next-intl';
import { Th } from './boq-sheet-cells';

/**
 * The sheet's column widths and its pinned header row.
 *
 * The widths are a <colgroup> rather than per-cell classes so that every row
 * agrees about where a column starts — which is what the two sticky columns
 * depend on, and what a per-cell width silently breaks the first time one row
 * renders a longer value.
 */
export function BoqSheetHead({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('projects.profile.boq');
  return (
    <>
      <colgroup>
        <col style={{ width: 72 }} />
        <col />
        <col style={{ width: 116 }} />
        <col style={{ width: 88 }} />
        <col style={{ width: 116 }} />
        <col style={{ width: 132 }} />
        <col style={{ width: 48 }} />
        {canEdit && <col style={{ width: 44 }} />}
      </colgroup>
      <thead>
        <tr>
          <Th sticky="code">{t('col.code')}</Th>
          <Th sticky="description">{t('col.description')}</Th>
          <Th>{t('col.unit')}</Th>
          <Th num>{t('col.qty')}</Th>
          <Th num>{t('col.rate')}</Th>
          <Th num>{t('col.total')}</Th>
          <Th>{t('col.provisionalShort')}</Th>
          {canEdit && <Th> </Th>}
        </tr>
      </thead>
    </>
  );
}
