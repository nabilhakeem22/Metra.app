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
 *
 * 5× MAX_IMPORT_ROWS, not 25×: at 50,000 a 3.4 MiB file of bare newlines was
 * fully parsed (+37 MiB of heap) before the bail, which is a lot of work to do
 * on the way to refusing.
 */
export const MAX_RAW_ROWS = 10_000;

/**
 * The other axis. A row cap bounds how many rows exist and says NOTHING about
 * how wide one is: 1 MiB of commas is a SINGLE row of 1,048,577 fields, which
 * cost +17.6 MiB of heap and never came near MAX_RAW_ROWS. This ceiling is
 * counted per FIELD, so a runaway width bails on the same terms a runaway height
 * does. 64 columns × the row cap — a real BOQ is eight columns wide.
 */
export const MAX_IMPORT_CELLS = MAX_IMPORT_ROWS * 64;

/**
 * Why an import could not be read. Coded rather than free text because each one
 * maps to a different sentence the studio can act on: make the file smaller,
 * split it, it has no rows, or it is not a CSV at all.
 */
export type ImportParseReason =
  | 'too_large'
  | 'too_many_rows'
  | 'too_many_cells'
  | 'empty'
  | 'unreadable';

export class ImportParseError extends Error {
  constructor(public reason: ImportParseReason) {
    super(reason);
    this.name = 'ImportParseError';
  }
}
