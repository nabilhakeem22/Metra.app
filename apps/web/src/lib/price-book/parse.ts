import 'server-only';
// Server-only spreadsheet parsing (A1, S1). Uses exceljs (maintained, no known
// advisories) — NEVER bundled to the client — with hard caps so a hostile upload
// can't exhaust memory. Accepts xlsx and csv. Returns a rectangular string[][]
// (header row included) for the mapping/preview step.
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

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

// exceljs cell values can be primitives, dates, or objects (formula results,
// rich text, hyperlinks). Flatten any of them to a trimmed string.
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text.trim();
    if (typeof o.result === 'string' || typeof o.result === 'number') {
      return String(o.result).trim();
    }
    if (Array.isArray(o.richText)) {
      return o.richText
        .map((r) => (r as { text?: string }).text ?? '')
        .join('')
        .trim();
    }
    if (typeof o.hyperlink === 'string') {
      return String(o.text ?? o.hyperlink).trim();
    }
  }
  return String(v).trim();
}

function looksLikeZip(bytes: Uint8Array): boolean {
  // xlsx is a zip archive -> starts with "PK" (0x50 0x4B).
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function worksheetToRows(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      arr[col - 1] = cellToString(cell.value);
    });
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i] === undefined) arr[i] = '';
    }
    // Skip fully-blank rows (matches the old blankrows:false behaviour).
    if (arr.some((c) => c !== '')) rows.push(arr);
  });
  return rows;
}

/**
 * Parse an uploaded workbook/csv into a string matrix. Enforces the 5MB / 2000
 * data-row caps. Throws SpreadsheetError with a coded reason; the core maps it.
 */
export async function parseSpreadsheet(
  bytes: Uint8Array,
): Promise<ParsedSheet> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new SpreadsheetError('too_large');
  }

  const buffer = Buffer.from(bytes);
  const wb = new ExcelJS.Workbook();
  let ws: ExcelJS.Worksheet | undefined;
  try {
    if (looksLikeZip(bytes)) {
      // Cast around exceljs's non-generic Buffer type vs node's Buffer<ArrayBuffer>.
      await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
      ws = wb.worksheets[0];
    } else {
      // CSV: exceljs reads from a stream.
      ws = await wb.csv.read(Readable.from(buffer));
    }
  } catch {
    throw new SpreadsheetError('unreadable');
  }

  if (!ws) throw new SpreadsheetError('empty');
  const rows = worksheetToRows(ws);
  if (rows.length === 0) throw new SpreadsheetError('empty');

  const [header, ...data] = rows;
  if (data.length > MAX_IMPORT_ROWS) {
    throw new SpreadsheetError('too_many_rows');
  }

  return { rows, header: header ?? [], data };
}
