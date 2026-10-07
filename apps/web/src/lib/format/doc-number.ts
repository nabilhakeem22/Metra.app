// The ONE document-number formatter — imported by every UI surface AND the PDF
// templates. The DB stores only the int sequence (per org); the display form is
// `<PREFIX>-YYYY-NNNN` (Q=quote/proposal, C=contract, VO=variation order,
// DE=design engagement, P=project, BQ=bill of quantities). PURE (no server/db imports) so it stays client-safe.
// Per-org sequence allocation lives in the server-only ./allocate-number module,
// not here.
export type DocPrefix = 'Q' | 'C' | 'VO' | 'DE' | 'P' | 'BQ';

export function formatDocNumber(
  prefix: DocPrefix,
  seq: number,
  year: number,
): string {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

/** The studio's clock: every document year is read in Egypt, on every runtime. */
const CAIRO_YEAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric' });

/**
 * The calendar year of an instant in Africa/Cairo, or NaN for an invalid one.
 *
 * ONE year rule. `getFullYear()` used the RUNTIME's zone: UTC on the Worker,
 * the browser's elsewhere, while the notification params and the studio email
 * use Cairo (app_delivery_notify_studio_by_token). For two hours around every
 * New Year the bell, the email and the page showed different DE numbers.
 */
export function cairoYear(instant: string | Date): number {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Number(CAIRO_YEAR.format(date));
}

/**
 * Resolve the display year: the issue date's year, else the creation year,
 * both in Cairo. A date-only issue date (`YYYY-MM-DD`, a `date` column) is a
 * calendar day already, so its own year is taken as written.
 */
export function docYear(
  issueDate: string | null | undefined,
  createdAt: string | Date,
): number {
  if (issueDate) {
    const dateOnly = /^(\d{4})-\d{2}-\d{2}$/.exec(issueDate);
    if (dateOnly) return Number(dateOnly[1]);
    const y = cairoYear(issueDate);
    if (Number.isFinite(y)) return y;
  }
  return cairoYear(createdAt);
}
