import type { SheetGrid } from '../decode';
import { cell, readRowCells, TRUTHY, type BoqImportRowIssue, type RowCells } from './cells';
import { CANONICAL_HEADERS, norm, REQUIRED, type ColumnMapping, type ImportField } from './columns';

export interface ImportedLine {
  itemCode: string | null;
  section: string;
  description: string;
  unit: string;
  qty: string;
  unitPrice: string;
  unitCost: string;
  provisional: boolean;
  costItemCode: string | null;
}

interface RowVerdict {
  /** 1-based row number IN THE FILE, so an error names what the studio sees. */
  rowNumber: number;
  line: ImportedLine | null;
  issues: BoqImportRowIssue[];
  /**
   * Deliberately left out of this BOQ rather than faulty. The template is
   * generated from the studio's whole price book, so most rows come back with an
   * empty quantity — those are items this project does not use, and calling that
   * an error would bury the real problems under hundreds of false ones.
   */
  skipped?: boolean;
}

export interface MapResult {
  rows: RowVerdict[];
  ok: ImportedLine[];
  errorCount: number;
  /** Rows with no quantity: priced items the studio did not take up. */
  skippedCount: number;
}

/** The section a line falls under when the sheet has no section column. */
export const DEFAULT_SECTION = 'General';

/** The line a row with no issues becomes. */
function importedLine(row: string[], mapping: ColumnMapping, cells: RowCells): ImportedLine {
  const sectionRaw = cell(row, mapping.section).trim();
  const codeRaw = cell(row, mapping.itemCode).trim();
  const pbRaw = cell(row, mapping.costItemCode).trim();

  return {
    itemCode: codeRaw === '' ? null : codeRaw,
    section: sectionRaw === '' ? DEFAULT_SECTION : sectionRaw,
    description: cells.description,
    unit: cells.unit as string,
    qty: cells.qty as string,
    unitPrice: cells.unitPrice as string,
    unitCost: cells.unitCost as string,
    provisional: TRUTHY.has(norm(cell(row, mapping.provisional))),
    costItemCode: pbRaw === '' ? null : pbRaw,
  };
}

/** One data row's verdict: unmapped columns, then a skipped row, then its issues, else its line. */
function mapRow(
  row: string[],
  rowNumber: number,
  mapping: ColumnMapping,
  missing: ImportField[],
): RowVerdict {
  const issues: BoqImportRowIssue[] = [];
  if (missing.length > 0) {
    return {
      rowNumber,
      line: null,
      issues: [
        {
          code: 'unmapped_columns',
          value: missing.map((field) => CANONICAL_HEADERS[field]).join(', '),
        },
      ],
    };
  }

  // An EMPTY quantity means "not in this BOQ" — check it before anything
  // else, so a price-book row the studio skipped is never also reported as
  // missing a description or carrying an odd unit.
  const rawQty = cell(row, mapping.qty).trim();
  if (rawQty === '') return { rowNumber, line: null, issues: [], skipped: true };

  const cells = readRowCells(row, mapping, rawQty, issues);
  if (issues.length > 0) return { rowNumber, line: null, issues };
  return { rowNumber, issues: [], line: importedLine(row, mapping, cells) };
}

/**
 * Map every data row. Rows are validated INDEPENDENTLY and a bad row never stops
 * the others: the studio gets one preview listing everything wrong rather than
 * discovering problems one upload at a time.
 */
export function mapRows(
  grid: SheetGrid,
  mapping: ColumnMapping,
  opts: { headerRowIndex?: number } = {},
): MapResult {
  const headerRowIndex = opts.headerRowIndex ?? 0;
  const dataRows = grid.rows.slice(headerRowIndex + 1);

  const missing = REQUIRED.filter((f) => mapping[f] < 0);

  const rows: RowVerdict[] = dataRows.map((row, i) =>
    mapRow(row, headerRowIndex + 2 + i, mapping, missing),
  );

  const ok = rows.flatMap((r) => (r.line ? [r.line] : []));
  const skippedCount = rows.filter((r) => r.skipped).length;
  return { rows, ok, errorCount: rows.length - ok.length - skippedCount, skippedCount };
}
