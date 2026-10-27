/**
 * The spreadsheet formula guard (S9, go-live security), both halves.
 *
 * PURE and CLIENT-SAFE: the BOQ preview reads a sheet in the browser.
 *
 * A CSV cell that starts with = + - @ TAB or CR runs as a formula when Excel
 * opens the file, so a price-book name like `=HYPERLINK(...)` would act on the
 * machine of whoever downloads the template. The write half prefixes such a cell
 * with one apostrophe, which spreadsheets show as text. The read half drops that
 * apostrophe again, so a downloaded template re-imports exactly as it left.
 */

export const FORMULA_GUARD = "'";

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** A plain decimal number is data, not a formula: `-5` stays `-5`. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

/** Prefix FORMULA_GUARD when the cell starts with = + - @ TAB or CR, unless it is a plain decimal number. */
export function neutralizeFormula(cell: string): string {
  if (!FORMULA_TRIGGERS.has(cell.charAt(0)) || PLAIN_DECIMAL.test(cell)) return cell;
  return `${FORMULA_GUARD}${cell}`;
}

/** The read half: drop ONE leading FORMULA_GUARD when the next character is = + - @ TAB or CR. */
export function stripFormulaGuard(cell: string): string {
  return cell.startsWith(FORMULA_GUARD) && FORMULA_TRIGGERS.has(cell.charAt(1)) ? cell.slice(1) : cell;
}
