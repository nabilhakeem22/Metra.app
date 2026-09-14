// The price book's view of the shared CSV decoder: byte and zip checks, then
// lib/import, then the rectangular ParsedSheet the mapping/preview step expects.
//
// The CSV parser, the caps and the reason codes used to be declared here AND in
// the BOQ import pipeline, which is how the two came to disagree about the
// double quote. They are shared now; what stays here is what is genuinely this
// pipeline's own — the upload-shaped checks (byte size, an xlsx-is-a-zip
// detection) and the SpreadsheetError surface its callers already map.
//
// `server-only` is deliberately GONE from this module. The parse path is now
// shared with the BOQ preview, which decodes in the BROWSER before anything is
// uploaded; nothing here reaches for a server API, so the marker was asserting a
// constraint the code does not have. The callers that DO write to the database
// keep their own.
//
// xlsx support was intentionally removed earlier: exceljs was the last large app
// dependency and pushed the Cloudflare Worker bundle over the hosting size
// limit. Users export their sheet to CSV.
import { decodeCsv, padToRectangle } from '@/lib/import/decode';
import {
  ImportParseError,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  MAX_RAW_ROWS,
  type ImportParseReason,
} from '@/lib/import/limits';

export { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS };

/** Alias kept for the callers that already map this union to a message. */
export type ParseError = ImportParseReason;

export class SpreadsheetError extends Error {
  constructor(public reason: ParseError) {
    super(reason);
    this.name = 'SpreadsheetError';
  }
}

export interface ParsedSheet {
  /** Every row as a string[] (first row is the header). */
  rows: string[][];
  /** Header (first row) convenience. */
  header: string[];
  /** Data rows (header excluded). */
  data: string[][];
}

function looksLikeZip(bytes: Uint8Array): boolean {
  // xlsx is a zip archive -> starts with "PK" (0x50 0x4B). CSV never does.
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Decode the bytes as UTF-8 text, or refuse the upload as unreadable. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    throw new SpreadsheetError('unreadable');
  }
}

/**
 * Parse an uploaded CSV into a string matrix, enforcing the 5 MiB and 2000
 * data-row caps. Throws SpreadsheetError with a coded reason; the core maps it.
 */
export async function parseSpreadsheet(bytes: Uint8Array): Promise<ParsedSheet> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new SpreadsheetError('too_large');
  // An xlsx (zip) upload can't be parsed as text — steer the user to CSV.
  if (looksLikeZip(bytes)) throw new SpreadsheetError('unreadable');

  let rows: string[][];
  try {
    rows = decodeCsv(decodeText(bytes), { maxRows: MAX_RAW_ROWS }).grid.rows;
  } catch (cause) {
    // The shared decoder speaks ImportParseError; this pipeline's callers speak
    // SpreadsheetError. Translate rather than leak a second error type.
    if (cause instanceof ImportParseError) throw new SpreadsheetError(cause.reason);
    throw cause;
  }
  if (rows.length === 0) throw new SpreadsheetError('empty');

  const [header, ...data] = padToRectangle(rows);
  if (data.length > MAX_IMPORT_ROWS) throw new SpreadsheetError('too_many_rows');

  return { rows, header: header ?? [], data };
}
