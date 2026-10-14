'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ImportPreview } from '@/lib/boqs/actions';

/** What an uploaded sheet would become, before anything is written: the lines,
 *  the notes and every row that would not import, with why. */
export function BoqImportPreview({
  preview,
  pending,
  onCommit,
  onCancel,
}: {
  preview: ImportPreview;
  pending: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('projects.profile.boq');
  return (
    <div className="space-y-3 rounded-item border border-[color:var(--rule)] p-4">
      <p className="text-body font-semibold text-[color:var(--text)]">
        {t('previewTitle', { count: String(preview.lines?.length ?? 0) })}
      </p>

      {preview.notes?.map((note) => (
        <p key={note} className="text-caption text-[color:var(--text-muted)]">
          {t(`importNotes.${note}`)}
        </p>
      ))}

      {preview.problems && preview.problems.length > 0 && (
        <div className="space-y-1">
          <p
            className="text-caption font-semibold"
            style={{ color: 'var(--danger)' }}
          >
            {t('previewProblems', { count: String(preview.problems.length) })}
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-caption text-[color:var(--text-muted)]">
            {preview.problems.slice(0, 20).map((p) => (
              <li key={p.rowNumber}>
                {t('rowLabel', { row: String(p.rowNumber) })}:{' '}
                {p.issues
                  .map((issue) =>
                    t(`importErrors.${issue.code}`, { value: issue.value ?? '' }),
                  )
                  .join('; ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="default" onClick={onCommit} disabled={pending}>
          {t('commitImport')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
