/**
 * The caps every spreadsheet import obeys, and the one error it raises.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`. The BOQ preview decodes in
 * the browser before anything is uploaded, so nothing on the parse path may
 * reach for a server-only dependency.
 *
 * Both pipelines had their own copies of these numbers, which meant "how big an
 * upload is too big" had two answers depending on which importer you used.
 */

/** 5 MiB. A real price book or BOQ is a few hundred KB; this is the hostile-file
 *  fence, not a product limit. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Data rows, header excluded. */
export const MAX_IMPORT_ROWS = 2000;

/**
 * Coarse memory guard: parsing bails once this many RAW rows (header + data +
 * blanks, pre-filter) have accumulated, so a pathological upload — a 5 MB file
 * of bare newlines — cannot materialise millions of tiny arrays before the fine
 * MAX_IMPORT_ROWS check runs. Far above any real sheet, so it only ever trips on
 * abusive input; the exact 2000-ok/2001-rejected data-row boundary is still
 * enforced downstream after blank-row filtering.
 */
export const MAX_RAW_ROWS = 50_000;

/**
 * Why an import could not be read. Coded rather than free text because each one
 * maps to a different sentence the studio can act on: make the file smaller,
 * split it, it has no rows, or it is not a CSV at all.
 */
export type ImportParseReason = 'too_large' | 'too_many_rows' | 'empty' | 'unreadable';

export class ImportParseError extends Error {
  constructor(public reason: ImportParseReason) {
    super(reason);
    this.name = 'ImportParseError';
  }
}
