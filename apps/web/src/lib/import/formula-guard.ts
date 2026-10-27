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
 *
 * Fix round 2, F4: a cell whose own text starts with apostrophes and then a
 * trigger (`'-5 with apostrophe`) gets one more too, so the read half, which
 * drops one apostrophe from exactly such a cell, gives the typed one back.
 */

export const FORMULA_GUARD = "'";

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Leading whitespace other than TAB and CR (themselves triggers), and format characters (Cf). */
const LEADING_INVISIBLE = /^(?:[^\S\t\r]|\p{Cf})+/u;

/** A plain decimal number is data, not a formula: `-5` stays `-5`. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

const LEADING_GUARDS = new RegExp(`^${FORMULA_GUARD}+`);

/** The cell as its first character is judged: NFKC, leading invisibles skipped. */
function formulaLead(cell: string): string {
  return cell.normalize('NFKC').replace(LEADING_INVISIBLE, '');
}

/** True when the cell, past any apostrophes it starts with, starts (as judged) with = + - @ TAB or CR. */
function triggersPastGuards(cell: string): boolean {
  return FORMULA_TRIGGERS.has(formulaLead(cell.replace(LEADING_GUARDS, '')).charAt(0));
}

/**
 * A formula (a plain decimal number is not one), or ANY trigger behind an
 * apostrophe the studio typed: the read half drops one apostrophe from the
 * latter, so it gets one more here.
 */
function needsGuard(cell: string): boolean {
  if (cell.startsWith(FORMULA_GUARD)) return triggersPastGuards(cell);
  const lead = formulaLead(cell);
  return FORMULA_TRIGGERS.has(lead.charAt(0)) && !PLAIN_DECIMAL.test(lead);
}

/** The write half: prefix FORMULA_GUARD to a cell that needs it (needsGuard). */
export function neutralizeFormula(cell: string): string {
  return needsGuard(cell) ? `${FORMULA_GUARD}${cell}` : cell;
}

/** The read half: drop ONE leading FORMULA_GUARD when a trigger follows it (past any further apostrophes). */
export function stripFormulaGuard(cell: string): string {
  return cell.startsWith(FORMULA_GUARD) && triggersPastGuards(cell) ? cell.slice(1) : cell;
}
