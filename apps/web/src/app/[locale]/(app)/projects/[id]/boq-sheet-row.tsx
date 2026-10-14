'use client';

import { useLocale } from 'next-intl';
import { memo } from 'react';
import { formatPercent } from '@/lib/format/number';
import { Td } from './boq-sheet-cells';
import { amountOf, type EditableLine, type RowEdits } from './boq-sheet-columns';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import type { BoqRowRefusals } from './use-boq-cell-errors';
import { BoqProvisionalCell, BoqRowActionsCell } from './boq-sheet-row-controls';
import { BoqCodeCell, BoqDescriptionCell, BoqNumberCell } from './boq-sheet-row-fields';
import { BoqUnitCell } from './boq-sheet-unit-cell';

// One BOQ line, as a row. Named BoqSheetRow and not BoqLineRow: BoqLineRow is
// already the RECORD type imported from @/lib/boqs/queries, and two different
// things with one name is how a reader ends up importing the wrong one.

export interface BoqSheetRowProps {
  line: EditableLine;
  api: BoqSheetRowApi;
  /** What the studio has typed into THIS row and not yet committed. */
  typed: RowEdits | undefined;
  /** What the server refused in THIS row, cell by cell. */
  refused: BoqRowRefusals | undefined;
  /** THIS row is mid-save. */
  saving: boolean;
  /** SOME write on the sheet is in flight, so its controls are disabled. */
  pending: boolean;
  /** This BOQ has line discounts, so every row shows its discount %. */
  discounted: boolean;
}

/** The line's discount %, read-only: the sheet does not edit line discounts. */
function BoqDiscountCell({ discountPct }: { discountPct: string }) {
  const locale = useLocale();
  return (
    <Td num>
      <span
        className="block whitespace-nowrap p-3 text-end font-mono tabular-nums text-[color:var(--text-muted)]"
        dir="ltr"
      >
        {formatPercent(discountPct, locale)}
      </span>
    </Td>
  );
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
  refused,
  saving,
  pending,
  discounted,
}: BoqSheetRowProps) {
  const cell = { line, api, typed, refused };
  return (
    <tr className="group border-b border-[color:var(--rule-soft)]">
      <BoqCodeCell {...cell} />
      <BoqDescriptionCell {...cell} />
      <BoqUnitCell {...cell} />
      <BoqNumberCell {...cell} column="qty" />
      <BoqNumberCell {...cell} column="unitPrice" />
      {discounted && <BoqDiscountCell discountPct={line.discountPct} />}
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
