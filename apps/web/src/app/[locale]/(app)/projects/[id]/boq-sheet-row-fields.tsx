'use client';

import { useLocale, useTranslations } from 'next-intl';
import { BOQ_UNITS } from '@/lib/boqs/edit-input';
import { formatQuantity } from '@/lib/format/number';
import { EditableCell, Td } from './boq-sheet-cells';
import { cellValueOf, type EditableLine, type RowEdits } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';

// The four cells of a BOQ row that HOLD A VALUE: code, description, unit and the
// two numbers. The two that ACT — the provisional toggle and the delete control —
// are boq-sheet-row-controls.tsx; the row itself composes both.
//
// Each takes the row's own uncommitted edits (`typed`) rather than reaching into
// a shared api for them, which is what lets the row be memoised.

const READ_ONLY_CODE = 'block p-3 font-mono text-[13px] text-[color:var(--text-muted)]';
const READ_ONLY_NUMBER = 'block whitespace-nowrap p-3 text-end font-mono tabular-nums';
const UNIT_SELECT =
  'w-full cursor-pointer rounded-[8px] border border-transparent bg-transparent p-3 text-sm text-[color:var(--text)] hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))] focus:outline-none';

export interface BoqFieldProps {
  line: EditableLine;
  api: BoqSheetRowApi;
  /** What the studio has typed into THIS row and not yet committed. */
  typed: RowEdits | undefined;
}

export function BoqCodeCell({ line, api, typed }: BoqFieldProps) {
  const t = useTranslations('projects.profile.boq');
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
        />
      ) : (
        <span className={READ_ONLY_CODE}>{line.itemCode}</span>
      )}
    </Td>
  );
}

export function BoqDescriptionCell({ line, api, typed }: BoqFieldProps) {
  const t = useTranslations('projects.profile.boq');
  return (
    <Td sticky="description">
      {api.canEdit ? (
        <EditableCell
          line={line}
          column="description"
          label={t('col.description')}
          value={cellValueOf(line, 'description', typed)}
          api={api}
        />
      ) : (
        <span className="block p-3" dir="auto">
          {line.description}
        </span>
      )}
    </Td>
  );
}

export function BoqUnitCell({ line, api, typed }: BoqFieldProps) {
  const t = useTranslations('projects.profile.boq');
  // A unit is a CHOICE, so it saves on change rather than on blur: there is no
  // half-typed state to protect the document from.
  return (
    <Td>
      {api.canEdit ? (
        <select
          value={cellValueOf(line, 'unit', typed)}
          data-col="unit"
          aria-label={t('col.unit')}
          onChange={(event) => {
            api.setCell(line.id, 'unit', event.target.value);
            api.saveLine(line, { unit: event.target.value }, ['unit']);
          }}
          className={UNIT_SELECT}
        >
          {BOQ_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`unit.${unit}`)}
            </option>
          ))}
        </select>
      ) : (
        <span className="block p-3 text-[color:var(--text-muted)]">
          {t(`unit.${line.unit}`)}
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
}: BoqFieldProps & { column: 'qty' | 'unitPrice' }) {
  const t = useTranslations('projects.profile.boq');
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
