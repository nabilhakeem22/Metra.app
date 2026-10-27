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
 *
 * Fix round T8: the first character is judged as a spreadsheet may read it.
 * NFKC folds the full-width forms (U+FF1D, U+FF0B, U+FF0D, U+FF20) to = + - @,
 * and leading invisible or format characters (a space, NBSP, LF, U+200B, the
 * BOM) are skipped. Only the decision is normalized: the cell's own text is
 * never changed beyond the one apostrophe.
 */

export const FORMULA_GUARD = "'";

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Leading whitespace other than TAB and CR (themselves triggers), and format characters (Cf). */
const LEADING_INVISIBLE = /^(?:[^\S\t\r]|\p{Cf})+/u;

/** A plain decimal number is data, not a formula: `-5` stays `-5`. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

/** The cell as its first character is judged: NFKC, leading invisibles skipped. */
function formulaLead(cell: string): string {
  return cell.normalize('NFKC').replace(LEADING_INVISIBLE, '');
}

const startsWithTrigger = (lead: string) => FORMULA_TRIGGERS.has(lead.charAt(0));

/** Prefix FORMULA_GUARD when the cell starts (as judged) with = + - @ TAB or CR, unless it is a plain decimal number. */
export function neutralizeFormula(cell: string): string {
  const lead = formulaLead(cell);
  return startsWithTrigger(lead) && !PLAIN_DECIMAL.test(lead) ? `${FORMULA_GUARD}${cell}` : cell;
}

/** The read half: drop ONE leading FORMULA_GUARD when what follows it starts (as judged) with a trigger. */
export function stripFormulaGuard(cell: string): string {
  return cell.startsWith(FORMULA_GUARD) && startsWithTrigger(formulaLead(cell.slice(1))) ? cell.slice(1) : cell;
}
