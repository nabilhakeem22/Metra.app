import 'server-only';
// Server-only CSV parsing (A1, S1) with hard caps so a hostile upload can't
// exhaust memory. Accepts CSV only. xlsx support was intentionally removed: the
// exceljs library was the last large app dependency and pushed the Cloudflare
// Worker bundle over the hosting size limit. Users export their sheet to CSV.
// Returns a rectangular string[][] (header row included) for the mapping/preview.

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMPORT_ROWS = 2000; // data rows (excludes header)

export type ParseError = 'too_large' | 'too_many_rows' | 'empty' | 'unreadable';

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

/**
 * Minimal RFC-4180 CSV parser (no dependency): handles quoted fields, escaped
 * double-quotes (""), and CRLF/LF/CR row terminators. Newlines and commas inside
 * quotes are literal. Each field is trimmed (matches the prior cell behaviour).
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      pushRow();
      if (text[i + 1] === '\n') i += 1; // swallow the LF of a CRLF pair
    } else {
      field += c;
    }
  }
  // Flush a trailing field/row that wasn't terminated by a newline.
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/**
 * Parse an uploaded CSV into a string matrix. Enforces the 5MB / 2000 data-row
 * caps. Throws SpreadsheetError with a coded reason; the core maps it.
 */
export async function parseSpreadsheet(
  bytes: Uint8Array,
): Promise<ParsedSheet> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new SpreadsheetError('too_large');
  }
  // An xlsx (zip) upload can't be parsed as text — steer the user to CSV.
  if (looksLikeZip(bytes)) {
    throw new SpreadsheetError('unreadable');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    throw new SpreadsheetError('unreadable');
  }
  // Strip a leading UTF-8 BOM (U+FEFF) so the first header cell isn't polluted.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const parsed = parseCsv(text);
  // Skip fully-blank rows (matches the old blankrows:false behaviour).
  const rows = parsed.filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) throw new SpreadsheetError('empty');

  // Pad to a rectangle so the mapping/preview step sees uniform columns.
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  for (const r of rows) {
    while (r.length < width) r.push('');
  }

  const [header, ...data] = rows;
  if (data.length > MAX_IMPORT_ROWS) {
    throw new SpreadsheetError('too_many_rows');
  }

  return { rows, header: header ?? [], data };
}
