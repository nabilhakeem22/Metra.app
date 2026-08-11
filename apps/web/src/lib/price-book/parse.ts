import 'server-only';
// Server-only spreadsheet parsing (A1). SheetJS runs ONLY here — never bundled to
// the client — with hard caps so a hostile upload can't exhaust memory. Accepts
// xlsx and csv (SheetJS auto-detects). Returns a rectangular string[][] (header
// row included) for the mapping/preview step.
import * as XLSX from 'xlsx';

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

/**
 * Parse an uploaded workbook/csv into a string matrix. Enforces the 5MB / 2000
 * data-row caps. Throws SpreadsheetError with a coded reason; the core maps it.
 */
export function parseSpreadsheet(bytes: Uint8Array): ParsedSheet {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new SpreadsheetError('too_large');
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', raw: false });
  } catch {
    throw new SpreadsheetError('unreadable');
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new SpreadsheetError('empty');
  const sheet = wb.Sheets[sheetName];

  // header:1 -> array-of-arrays; defval:'' keeps rows rectangular; raw:false so
  // numbers/dates arrive as their formatted text (we validate as strings).
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  const rows: string[][] = matrix.map((r) =>
    (Array.isArray(r) ? r : []).map((c) =>
      c === null || c === undefined ? '' : String(c).trim(),
    ),
  );

  if (rows.length === 0) throw new SpreadsheetError('empty');

  const [header, ...data] = rows;
  if (data.length > MAX_IMPORT_ROWS) {
    throw new SpreadsheetError('too_many_rows');
  }

  return { rows, header: header ?? [], data };
}
