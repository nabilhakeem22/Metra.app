import { stripFormulaGuard } from '@/lib/import/formula-guard';
import { readMoney } from '@/lib/money/read';
import { unitFromToken } from '@/lib/units/unit-aliases';
import type { ColumnMapping } from './columns';

/**
 * A numeric cell as typed by a human: "1,200.50", "١٢٫٥", " 12 ".
 *
 * This is the ONLY money surface that reads Arabic-Indic digits, and it has to:
 * a studio typing into Excel on an Arabic keyboard produces ٠١٢٣, `Number('١٢')`
 * is NaN, and a sheet that looks perfectly valid would otherwise import as a
 * page of errors. Negatives are read here and rejected by the row validator
 * below with their own code (`*_negative`) rather than refused as unreadable:
 * the negative-quantity code tells the studio what to fix, and the code for an
 * unreadable cell does not.
 */
const IMPORTED_CELL = {
  allowNegative: true,
  allowGroupSeparators: true,
  allowArabicDigits: true,
} as const;

/**
 * Why a row cannot become a line. A CODE, never a sentence: the importer runs in
 * an Arabic-first product and every one of these used to be built here as English
 * prose and printed verbatim into the ar-EG preview. Mirrors the price book's
 * `ImportRowError` + `priceBook.import.errors.*`.
 */
type BoqImportRowErrorCode =
  | 'unmapped_columns'
  | 'description_empty'
  | 'unit_empty'
  | 'unit_unknown'
  | 'qty_not_a_number'
  | 'qty_too_large'
  | 'qty_negative'
  | 'unit_price_not_a_number'
  | 'unit_price_too_large'
  | 'unit_price_negative'
  | 'unit_cost_not_a_number'
  | 'unit_cost_too_large';

export interface BoqImportRowIssue {
  code: BoqImportRowErrorCode;
  /** The offending cell, or the joined field list for `unmapped_columns`. The
   *  message interpolates it, so the studio sees WHICH value was refused. */
  value?: string;
}

/** The three money cells, and the two codes each can earn. */
type MoneyField = 'qty' | 'unit_price' | 'unit_cost';

/**
 * One money cell, with the row issue it earns. `null` = the row is rejected.
 *
 * `*_not_a_number` and `*_too_large` are different problems and the studio fixes
 * them differently: one is a typo or a stray unit in the cell, the other is a
 * figure past the 1e12 cap that reads perfectly well. Reporting 10000000000000
 * as unreadable is both wrong and unactionable.
 */
function readCell(
  raw: string,
  field: MoneyField,
  issues: BoqImportRowIssue[],
): string | null {
  const result = readMoney(raw, IMPORTED_CELL);
  if (result.ok) return result.value;
  issues.push({
    code: `${field}${result.reason === 'too_large' ? '_too_large' : '_not_a_number'}`,
  });
  return null;
}

/** The shared alias table (lib/units/unit-aliases.ts), so both importers agree. */
export function normalizeUnit(raw: string): string | null {
  return unitFromToken(raw);
}

export const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'نعم', 'صح', '✓', 'x']);

/** The row's unit through the shared alias table; an empty or unknown unit earns its issue. */
function readUnit(rawUnit: string, issues: BoqImportRowIssue[]): string | null {
  const unit = normalizeUnit(rawUnit);
  if (unit === null) {
    issues.push(
      rawUnit.trim() === ''
        ? { code: 'unit_empty' }
        : { code: 'unit_unknown', value: rawUnit.trim() },
    );
  }
  return unit;
}

/**
 * One cell of a row by mapped column index; '' when the column is unmapped or the
 * row is short. The template's formula guard is dropped (lib/import/formula-guard.ts).
 */
export const cell = (row: string[], idx: number) => (idx >= 0 ? stripFormulaGuard(row[idx] ?? '') : '');

/** The cells of one row that become its line, read before the line is built. */
export interface RowCells {
  description: string;
  unit: string | null;
  qty: string | null;
  unitPrice: string | null;
  unitCost: string | null;
}

/** Reads the row's description, unit, qty, unit price and unit cost, pushing each refusal onto `issues`. */
export function readRowCells(
  row: string[],
  mapping: ColumnMapping,
  rawQty: string,
  issues: BoqImportRowIssue[],
): RowCells {
  const description = cell(row, mapping.description).trim();
  if (description === '') issues.push({ code: 'description_empty' });

  const unit = readUnit(cell(row, mapping.unit), issues);

  const qty = readCell(rawQty, 'qty', issues);
  if (qty !== null && qty.startsWith('-')) issues.push({ code: 'qty_negative' });

  const unitPrice = readCell(cell(row, mapping.unitPrice), 'unit_price', issues);
  if (unitPrice !== null && unitPrice.startsWith('-')) {
    issues.push({ code: 'unit_price_negative' });
  }

  // Cost is optional: a line without one is tracked for quantity but blind on
  // margin, which is a real state and not an error.
  const rawCost = cell(row, mapping.unitCost);
  const unitCost =
    rawCost.trim() === '' ? '0' : readCell(rawCost, 'unit_cost', issues);
  return { description, unit, qty, unitPrice, unitCost };
}
