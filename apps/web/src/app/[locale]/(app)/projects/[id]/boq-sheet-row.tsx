'use client';

import { memo } from 'react';
import { Td } from './boq-sheet-cells';
import { amountOf, type EditableLine, type RowEdits } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import { BoqProvisionalCell, BoqRowActionsCell } from './boq-sheet-row-controls';
import {
  BoqCodeCell,
  BoqDescriptionCell,
  BoqNumberCell,
  BoqUnitCell,
} from './boq-sheet-row-fields';

// One BOQ line, as a row. Named BoqSheetRow and not BoqLineRow: BoqLineRow is
// already the RECORD type imported from @/lib/boqs/queries, and two different
// things with one name is how a reader ends up importing the wrong one.

export interface BoqSheetRowProps {
  line: EditableLine;
  api: BoqSheetRowApi;
  /** What the studio has typed into THIS row and not yet committed. */
  typed: RowEdits | undefined;
  /** THIS row is mid-save. */
  saving: boolean;
  /** SOME write on the sheet is in flight, so its controls are disabled. */
  pending: boolean;
}

/**
 * MEMOISED, and every prop above is either a primitive or an identity that
 * changes only when this row's own state does: `api` is stable for the life of
 * the sheet (see boq-sheet-row-api.ts), `typed` is this row's slice of the edits
 * record, and `line` comes from a memoised filter. So a keystroke re-renders the
 * row being typed in and no other.
 *
 * Measured on a 2,000-line sheet, one keystroke in one description cell: 2,103
 * row-amount formats and ~1,200ms before, 104 and ~100ms after. The default
 * shallow comparison is enough precisely because nothing per-render travels
 * inside `api`; a custom comparator would only hide it if something did.
 */
export const BoqSheetRow = memo(function BoqSheetRow({
  line,
  api,
  typed,
  saving,
  pending,
}: BoqSheetRowProps) {
  return (
    <tr className="group border-b border-[color:var(--rule-soft)]">
      <BoqCodeCell line={line} api={api} typed={typed} />
      <BoqDescriptionCell line={line} api={api} typed={typed} />
      <BoqUnitCell line={line} api={api} typed={typed} />
      <BoqNumberCell line={line} column="qty" api={api} typed={typed} />
      <BoqNumberCell line={line} column="unitPrice" api={api} typed={typed} />
      <Td num>
        <span
          className="block whitespace-nowrap p-3 text-end font-mono font-semibold tabular-nums text-[color:var(--text)]"
          dir="ltr"
        >
          {api.money(amountOf(line, typed))}
        </span>
      </Td>
      <BoqProvisionalCell line={line} api={api} pending={pending} />
      {api.canEdit && (
        <BoqRowActionsCell line={line} api={api} saving={saving} pending={pending} />
      )}
    </tr>
  );
});
