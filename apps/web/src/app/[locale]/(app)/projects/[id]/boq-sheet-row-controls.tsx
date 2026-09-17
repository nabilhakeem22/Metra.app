'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { Td } from './boq-sheet-cells';
import type { EditableLine } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';

// The two cells of a BOQ row that act rather than hold a value: the provisional
// toggle and the delete control. They live beside boq-sheet-row.tsx rather than
// in it so that both files stay under the 150-line cap; the row composes them.

const PROVISIONAL_ON: CSSProperties = {
  borderColor: 'var(--warn)',
  background: 'var(--warn-tint)',
  color: 'var(--warn)',
};

const PROVISIONAL_OFF: CSSProperties = {
  borderColor: 'var(--rule)',
  color: 'var(--text-faint)',
};

/**
 * A provisional line is one whose quantity is not yet real. The toggle saves
 * immediately with an EMPTY column list: nothing was typed, so there is no local
 * edit to clear on the way back.
 */
export function BoqProvisionalCell({
  line,
  api,
}: {
  line: EditableLine;
  api: BoqSheetRowApi;
}) {
  const t = useTranslations('projects.profile.boq');
  return (
    <Td>
      <div className="flex justify-center p-3">
        {api.canEdit ? (
          <button
            type="button"
            aria-pressed={line.provisional}
            aria-label={t('provisional')}
            title={t('provisional')}
            disabled={api.pending}
            onClick={() => api.saveLine(line, { provisional: !line.provisional }, [])}
            className="inline-flex size-6 items-center justify-center rounded-[8px] border font-mono text-[10px] font-bold"
            style={line.provisional ? PROVISIONAL_ON : PROVISIONAL_OFF}
          >
            P
          </button>
        ) : (
          line.provisional && (
            <span
              className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--warn-tint)', color: 'var(--warn)' }}
            >
              {t('provisional')}
            </span>
          )
        )}
      </div>
    </Td>
  );
}

/** The spinner replaces the delete control while THIS row is mid-save. */
export function BoqRowActionsCell({
  line,
  api,
}: {
  line: EditableLine;
  api: BoqSheetRowApi;
}) {
  const t = useTranslations('projects.profile.boq');
  return (
    <Td>
      <div className="flex justify-center p-3">
        {api.isSaving(line.id) ? (
          <Loader2
            className="size-4 animate-spin text-[color:var(--text-faint)]"
            aria-label={t('saving')}
          />
        ) : (
          <button
            type="button"
            onClick={() => api.onDeleteLine(line.id)}
            disabled={api.pending}
            aria-label={t('deleteLine')}
            title={t('deleteLine')}
            className="rounded-[8px] p-1 text-[color:var(--text-faint)] hover:text-[color:var(--danger)]"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </Td>
  );
}
