'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatQuantity } from '@/lib/format/number';
import { Td } from './boq-sheet-cells';
import { cellValueOf, type EditableLine, type RowEdits } from './boq-sheet-columns';
import { EditableCell, useCellRefusal } from './boq-sheet-editable-cell';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import type { BoqRowRefusals } from './use-boq-cell-errors';

// The four cells of a BOQ row that HOLD A VALUE: code, description, unit and the
// two numbers. The two that ACT — the provisional toggle and the delete control —
// are boq-sheet-row-controls.tsx; the row itself composes both.
//
// Each takes the row's own uncommitted edits (`typed`) rather than reaching into
// a shared api for them, which is what lets the row be memoised.

const READ_ONLY_CODE = 'block p-3 text-small text-[color:var(--text-muted)] ltr:font-mono';
const READ_ONLY_NUMBER = 'block whitespace-nowrap p-3 text-end font-mono tabular-nums';

export interface BoqFieldProps {
  line: EditableLine;
  api: BoqSheetRowApi;
  /** What the studio has typed into THIS row and not yet committed. */
  typed: RowEdits | undefined;
  /** What the server refused in THIS row. */
  refused: BoqRowRefusals | undefined;
}


export function BoqCodeCell({ line, api, typed, refused }: BoqFieldProps) {
  const t = useTranslations('projects.profile.boq');
  const refusal = useCellRefusal(refused, 'itemCode');
  return (
    <Td sticky="code" dirty={typed !== undefined}>
      {api.canEdit ? (
        <EditableCell
          line={line}
          column="itemCode"
          label={t('col.code')}
          value={cellValueOf(line, 'itemCode', typed)}
          api={api}
          mono
          refusal={refusal}
        />
      ) : (
        <span className={READ_ONLY_CODE}>{line.itemCode}</span>
      )}
    </Td>
  );
}

export function BoqDescriptionCell({ line, api, typed, refused }: BoqFieldProps) {
  const t = useTranslations('projects.profile.boq');
  const refusal = useCellRefusal(refused, 'description');
  return (
    <Td sticky="description">
      {api.canEdit ? (
        <EditableCell
          line={line}
          column="description"
          label={t('col.description')}
          value={cellValueOf(line, 'description', typed)}
          api={api}
          refusal={refusal}
        />
      ) : (
        <span className="block p-3" dir="auto">
          {line.description}
        </span>
      )}
    </Td>
  );
}

export function BoqNumberCell({
  line,
  column,
  api,
  typed,
  refused,
}: BoqFieldProps & { column: 'qty' | 'unitPrice' }) {
  const t = useTranslations('projects.profile.boq');
  const refusal = useCellRefusal(refused, column);
  const locale = useLocale();
  const label = column === 'qty' ? t('col.qty') : t('col.rate');
  return (
    <Td num>
      {api.canEdit ? (
        <EditableCell
          line={line}
          column={column}
          label={label}
          value={cellValueOf(line, column, typed)}
          api={api}
          mono
          numeric
          refusal={refusal}
        />
      ) : (
        // FORMATTED INSIDE THE BRANCH THAT RENDERS IT. Hoisted out, an editable
        // sheet -- the only mode you can type in -- paid for a number it threw
        // away on every row of every render: two fresh Intl.NumberFormat
        // instances per row, 4,000 of them per keystroke at 2,000 lines.
        <span className={READ_ONLY_NUMBER} dir="ltr">
          {column === 'qty' ? formatQuantity(line.qty, locale) : api.money(line.unitPrice)}
        </span>
      )}
    </Td>
  );
}
