// Turn a decoded grid into draft BOQ lines, with a per-row verdict the preview
// can render. PURE — no db, no server-only — so the preview shows exactly what
// the commit will write.
//
// Nothing here knows what a CSV is. It takes a SheetGrid, so the same code
// serves an XLSX decoder unchanged.

import { readMoney } from '@/lib/money/read';
import type { SheetGrid } from './decode';

/** The fields a BOQ line can be imported from. Order drives the template. */
export const IMPORT_FIELDS = [
  'itemCode',
  'section',
  'description',
  'unit',
  'qty',
  'unitPrice',
  'unitCost',
  'provisional',
  'costItemCode',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index per field; -1 means "not present in this sheet". */
export type ColumnMapping = Record<ImportField, number>;

const EMPTY_MAPPING: ColumnMapping = {
  itemCode: -1,
  section: -1,
  description: -1,
  unit: -1,
  qty: -1,
  unitPrice: -1,
  unitCost: -1,
  provisional: -1,
  costItemCode: -1,
};

/**
 * Header aliases, English and Arabic. The template writes the first of each, but
 * a studio importing their own sheet gets a free ride on the common variants —
 * which is what makes the mapping step usually a confirmation rather than work.
 */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  itemCode: ['item', 'item code', 'code', 'ref', 'بند', 'كود', 'رقم البند'],
  section: ['section', 'category', 'group', 'قسم', 'بند رئيسي', 'المجموعة'],
  description: ['description', 'desc', 'item description', 'work', 'الوصف', 'البيان', 'وصف'],
  unit: ['unit', 'uom', 'الوحدة', 'وحدة'],
  qty: ['qty', 'quantity', 'الكمية', 'كمية'],
  unitPrice: ['unit price', 'rate', 'price', 'سعر الوحدة', 'السعر', 'فئة'],
  unitCost: ['unit cost', 'cost', 'التكلفة', 'تكلفة الوحدة'],
  provisional: ['provisional', 'estimated', 'تقديري', 'مؤقت'],
  costItemCode: ['price book', 'price book code', 'pb code', 'كود التسعير'],
};

/** Fields without which a row cannot become a line. */
const REQUIRED: ImportField[] = ['description', 'unit', 'qty', 'unitPrice'];

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, ' ');

/** Match a sheet's header row to fields. Unmatched fields stay at -1. */
export function autoDetectMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const taken = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field].map(norm);
    const idx = header.findIndex(
      (h, i) => !taken.has(i) && aliases.includes(norm(h)),
    );
    if (idx >= 0) {
      mapping[field] = idx;
      taken.add(idx);
    }
  }
  return mapping;
}

/**
 * A numeric cell as typed by a human: "1,200.50", "١٢٫٥", " 12 ".
 *
 * This is the ONLY money surface that reads Arabic-Indic digits, and it has to:
 * a studio typing into Excel on an Arabic keyboard produces ٠١٢٣, `Number('١٢')`
 * is NaN, and a sheet that looks perfectly valid would otherwise import as a
 * page of errors. Negatives are read here and rejected by the row validator
 * below with their own code (`*_negative`) rather than refused as unreadable:
 * the negative-quantity code tells the studio what to fix, and the code for an
 * unreadable cell does not.
 */
const IMPORTED_CELL = {
  allowNegative: true,
  allowGroupSeparators: true,
  allowArabicDigits: true,
} as const;

/**
 * Why a row cannot become a line. A CODE, never a sentence: the importer runs in
 * an Arabic-first product and every one of these used to be built here as English
 * prose and printed verbatim into the ar-EG preview. Mirrors the price book's
 * `ImportRowError` + `priceBook.import.errors.*`.
 */
export type BoqImportRowErrorCode =
  | 'unmapped_columns'
  | 'description_empty'
  | 'unit_empty'
  | 'unit_unknown'
  | 'qty_not_a_number'
  | 'qty_too_large'
  | 'qty_negative'
  | 'unit_price_not_a_number'
  | 'unit_price_too_large'
  | 'unit_price_negative'
  | 'unit_cost_not_a_number'
  | 'unit_cost_too_large';

export interface BoqImportRowIssue {
  code: BoqImportRowErrorCode;
  /** The offending cell, or the joined field list for `unmapped_columns`. The
   *  message interpolates it, so the studio sees WHICH value was refused. */
  value?: string;
}

/** The three money cells, and the two codes each can earn. */
type MoneyField = 'qty' | 'unit_price' | 'unit_cost';

/**
 * One money cell, with the row issue it earns. `null` = the row is rejected.
 *
 * `*_not_a_number` and `*_too_large` are different problems and the studio fixes
 * them differently: one is a typo or a stray unit in the cell, the other is a
 * figure past the 1e12 cap that reads perfectly well. Reporting 10000000000000
 * as unreadable is both wrong and unactionable.
 */
function readCell(
  raw: string,
  field: MoneyField,
  issues: BoqImportRowIssue[],
): string | null {
  const result = readMoney(raw, IMPORTED_CELL);
  if (result.ok) return result.value;
  issues.push({
    code: `${field}${result.reason === 'too_large' ? '_too_large' : '_not_a_number'}`,
  });
  return null;
}

/** Metra's unit list, and what studios actually write for each. */
const UNIT_ALIASES: Record<string, string[]> = {
  sqm: ['sqm', 'm2', 'm²', 'sq m', 'sq.m', 'square meter', 'متر مربع', 'م2', 'م²'],
  linear_meter: ['lm', 'l.m', 'm', 'meter', 'metre', 'linear meter', 'متر طولي', 'م ط', 'مط'],
  pcs: ['pcs', 'pc', 'piece', 'no', 'nos', 'each', 'ea', 'عدد', 'قطعة'],
  lump_sum: ['ls', 'lump sum', 'lumpsum', 'sum', 'مقطوعية', 'جملة'],
  day: ['day', 'days', 'يوم', 'أيام'],
};

export function normalizeUnit(raw: string): string | null {
  const t = norm(raw);
  if (t === '') return null;
  for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) {
    if (unit === t || aliases.some((a) => norm(a) === t)) return unit;
  }
  return null;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'نعم', 'صح', '✓', 'x']);

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

export interface RowVerdict {
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

const cell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '') : '');

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

  const rows: RowVerdict[] = dataRows.map((row, i) => {
    const rowNumber = headerRowIndex + 2 + i;
    const issues: BoqImportRowIssue[] = [];

    if (missing.length > 0) {
      return {
        rowNumber,
        line: null,
        issues: [{ code: 'unmapped_columns', value: missing.join(', ') }],
      };
    }

    // An EMPTY quantity means "not in this BOQ" — check it before anything
    // else, so a price-book row the studio skipped is never also reported as
    // missing a description or carrying an odd unit.
    const rawQty = cell(row, mapping.qty).trim();
    if (rawQty === '') return { rowNumber, line: null, issues: [], skipped: true };

    const description = cell(row, mapping.description).trim();
    if (description === '') issues.push({ code: 'description_empty' });

    const rawUnit = cell(row, mapping.unit);
    const unit = normalizeUnit(rawUnit);
    if (unit === null) {
      issues.push(
        rawUnit.trim() === ''
          ? { code: 'unit_empty' }
          : { code: 'unit_unknown', value: rawUnit.trim() },
      );
    }

    const qty = readCell(rawQty, 'qty', issues);
    if (qty !== null && qty.startsWith('-')) issues.push({ code: 'qty_negative' });

    const unitPrice = readCell(cell(row, mapping.unitPrice), 'unit_price', issues);
    if (unitPrice !== null && unitPrice.startsWith('-')) {
      issues.push({ code: 'unit_price_negative' });
    }

    // Cost is optional: a line without one is tracked for quantity but blind on
    // margin, which is a real state and not an error.
    const rawCost = cell(row, mapping.unitCost);
    const unitCost =
      rawCost.trim() === '' ? '0' : readCell(rawCost, 'unit_cost', issues);

    if (issues.length > 0) return { rowNumber, line: null, issues };

    const sectionRaw = cell(row, mapping.section).trim();
    const codeRaw = cell(row, mapping.itemCode).trim();
    const pbRaw = cell(row, mapping.costItemCode).trim();

    return {
      rowNumber,
      issues: [],
      line: {
        itemCode: codeRaw === '' ? null : codeRaw,
        section: sectionRaw === '' ? DEFAULT_SECTION : sectionRaw,
        description,
        unit: unit as string,
        qty: qty as string,
        unitPrice: unitPrice as string,
        unitCost: unitCost as string,
        provisional: TRUTHY.has(norm(cell(row, mapping.provisional))),
        costItemCode: pbRaw === '' ? null : pbRaw,
      },
    };
  });

  const ok = rows.flatMap((r) => (r.line ? [r.line] : []));
  const skippedCount = rows.filter((r) => r.skipped).length;
  return { rows, ok, errorCount: rows.length - ok.length - skippedCount, skippedCount };
}
