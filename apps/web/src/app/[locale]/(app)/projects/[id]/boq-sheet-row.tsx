'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { KeyboardEvent } from 'react';
import { BOQ_UNITS } from '@/lib/boqs/edit-input';
import { formatQuantity } from '@/lib/format/number';
import { EditableCell, Td } from './boq-sheet-cells';
import type { EditableLine } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import { BoqProvisionalCell, BoqRowActionsCell } from './boq-sheet-row-controls';

// One BOQ line, as a row. Named BoqSheetRow and not BoqLineRow: BoqLineRow is
// already the RECORD type imported from @/lib/boqs/queries, and two different
// things with one name is how a reader ends up importing the wrong one.

const READ_ONLY_CODE = 'block p-3 font-mono text-[13px] text-[color:var(--text-muted)]';
const READ_ONLY_NUMBER = 'block whitespace-nowrap p-3 text-end font-mono tabular-nums';
const UNIT_SELECT =
  'w-full cursor-pointer rounded-[8px] border border-transparent bg-transparent p-3 text-sm text-[color:var(--text)] hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))] focus:outline-none';

function BoqCodeCell({ line, api }: { line: EditableLine; api: BoqSheetRowApi }) {
  const t = useTranslations('projects.profile.boq');
  return (
    <Td sticky="code" dirty={api.isDirty(line.id)}>
      {api.canEdit ? (
        <EditableCell line={line} column="itemCode" label={t('col.code')} api={api} mono />
      ) : (
        <span className={READ_ONLY_CODE}>{line.itemCode}</span>
      )}
    </Td>
  );
}

function BoqDescriptionCell({ line, api }: { line: EditableLine; api: BoqSheetRowApi }) {
  const t = useTranslations('projects.profile.boq');
  return (
    <Td sticky="description">
      {api.canEdit ? (
        <EditableCell line={line} column="description" label={t('col.description')} api={api} />
      ) : (
        <span className="block p-3" dir="auto">
          {line.description}
        </span>
      )}
    </Td>
  );
}

function BoqUnitCell({ line, api }: { line: EditableLine; api: BoqSheetRowApi }) {
  const t = useTranslations('projects.profile.boq');
  // A unit is a CHOICE, so it saves on change rather than on blur: there is no
  // half-typed state to protect the document from.
  return (
    <Td>
      {api.canEdit ? (
        <select
          value={api.cellValue(line, 'unit')}
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

function BoqNumberCell({
  line,
  column,
  api,
}: {
  line: EditableLine;
  column: 'qty' | 'unitPrice';
  api: BoqSheetRowApi;
}) {
  const t = useTranslations('projects.profile.boq');
  const locale = useLocale();
  const label = column === 'qty' ? t('col.qty') : t('col.rate');
  const stored =
    column === 'qty' ? formatQuantity(line.qty, locale) : api.money(line.unitPrice);
  return (
    <Td num>
      {api.canEdit ? (
        <EditableCell line={line} column={column} label={label} api={api} mono numeric />
      ) : (
        <span className={READ_ONLY_NUMBER} dir="ltr">
          {stored}
        </span>
      )}
    </Td>
  );
}

export function BoqSheetRow({ line, api }: { line: EditableLine; api: BoqSheetRowApi }) {
  return (
    <tr className="group border-b border-[color:var(--rule-soft)]">
      <BoqCodeCell line={line} api={api} />
      <BoqDescriptionCell line={line} api={api} />
      <BoqUnitCell line={line} api={api} />
      <BoqNumberCell line={line} column="qty" api={api} />
      <BoqNumberCell line={line} column="unitPrice" api={api} />
      <Td num>
        <span
          className="block whitespace-nowrap p-3 text-end font-mono font-semibold tabular-nums text-[color:var(--text)]"
          dir="ltr"
        >
          {api.money(api.amountOf(line))}
        </span>
      </Td>
      <BoqProvisionalCell line={line} api={api} />
      {api.canEdit && <BoqRowActionsCell line={line} api={api} />}
    </tr>
  );
}
