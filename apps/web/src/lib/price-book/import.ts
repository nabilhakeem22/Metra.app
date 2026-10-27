// PURE price-book import validator. No server-only deps, no drizzle values:
// importable by the client preview AND vitest. Section and unit tokens resolve
// through ./import-resolvers (re-exported below so every import path is
// unchanged); unknown tokens are REJECTED per-row (category_invalid); import
// never auto-creates a section.
import type { CostItemUnit } from '@metra/db';
import { readMoneyString } from '@/lib/money/read';
import type { FieldRead } from '@/lib/validation/field-rules';
import { COST_ITEM_CODE_MAX, COST_ITEM_NAME_MAX, readCostItemCode, readCostItemName } from './cost-item-input';
import { resolveSection, resolveUnit, type ImportSection } from './import-resolvers';

export { UNIT_TOKENS, resolveSection, resolveUnit, type ImportSection } from './import-resolvers';

type ImportRowError =
  | 'row_empty'
  | 'code_missing'
  | 'code_too_long'
  | 'code_unprintable'
  | 'code_duplicate_in_file'
  | 'code_exists'
  | 'name_missing'
  | 'name_too_long'
  | 'name_unprintable'
  | 'category_invalid'
  | 'unit_invalid'
  | 'cost_invalid'
  | 'price_invalid';

/** Which 0-based source column feeds each field. Optional fields may be absent. */
export interface ColumnMapping {
  code: number;
  nameEn?: number;
  nameAr?: number;
  category: number;
  unit: number;
  cost: number;
  price: number;
  taxCode?: number;
  etaItemCode?: number;
  etaCodeType?: number;
}

interface ParsedCostItem {
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  sectionId: string;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  taxCode: string | null;
  etaItemCode: string | null;
  etaCodeType: string | null;
}

export interface ValidatedRow {
  /** 0-based index within the data rows passed in. */
  index: number;
  code: string;
  ok: boolean;
  error?: ImportRowError;
  data?: ParsedCostItem;
}

function cell(row: string[], i: number | undefined): string {
  if (i === undefined) return '';
  const v = row[i];
  return typeof v === 'string' ? v.trim() : '';
}

/** The values the row errors that name a cap are said with (priceBook.import.errors.*). */
export const IMPORT_ERROR_PARAMS = { codeMax: COST_ITEM_CODE_MAX, nameMax: COST_ITEM_NAME_MAX } as const;

/**
 * A code or name cell the cost-item rules refuse (./cost-item-input: the caps
 * an edit keeps, and no control character), as its row error; null when it
 * reads. A row imported here can always be edited later.
 */
function textError(read: FieldRead<unknown>, field: 'code' | 'name'): ImportRowError | null {
  if (read.ok) return null;
  return read.error.code === 'too_long' ? `${field}_too_long` : `${field}_unprintable`;
}

/** The codes a sheet carries under its mapping, as validateImportRows reads them (blank cells left out). */
export function importedCodes(rows: string[][], mapping: ColumnMapping): string[] {
  return rows.map((row) => cell(row, mapping.code)).filter((code) => code !== '');
}

// A cost/price cell in an imported price-book sheet. Comma-as-thousands is
// accepted and stripped; an ambiguous separator ("1,5", "1.234,56", "1,2,3") is
// REFUSED and the row becomes cost_invalid/price_invalid rather than silently
// becoming a different number. Negatives, ".5", "1.", "1e3", currency prefixes
// and Arabic-Indic digits are refused too. A blank cell is a zero.
const MONEY_CELL = { allowGroupSeparators: true, blank: '0' } as const;

/** One row's cells, trimmed, under the column mapping (an unmapped column reads as ''). */
interface RowCells {
  code: string;
  nameEn: string;
  nameAr: string;
  categoryRaw: string;
  unitRaw: string;
  costRaw: string;
  priceRaw: string;
}

function readCells(row: string[], mapping: ColumnMapping): RowCells {
  return {
    code: cell(row, mapping.code),
    nameEn: cell(row, mapping.nameEn),
    nameAr: cell(row, mapping.nameAr),
    categoryRaw: cell(row, mapping.category),
    unitRaw: cell(row, mapping.unit),
    costRaw: cell(row, mapping.cost),
    priceRaw: cell(row, mapping.price),
  };
}

/** The first refusal on the row's identity (empty, code, name), in check order; null when it reads. */
function identityError(c: RowCells, existingCodes: Set<string>, seen: Set<string>): ImportRowError | null {
  const anyFilled =
    c.code || c.nameEn || c.nameAr || c.categoryRaw || c.unitRaw || c.costRaw || c.priceRaw;
  if (!anyFilled) return 'row_empty';
  if (!c.code) return 'code_missing';
  const codeError = textError(readCostItemCode(c.code), 'code');
  if (codeError) return codeError;
  // Case-SENSITIVE: the DB unique(org_id, code) is case-sensitive, so `ABC`
  // and `abc` are distinct codes and must not be collapsed here.
  if (seen.has(c.code)) return 'code_duplicate_in_file';
  if (existingCodes.has(c.code)) return 'code_exists';
  if (!c.nameEn && !c.nameAr) return 'name_missing';
  return textError(readCostItemName(c.nameEn), 'name') ?? textError(readCostItemName(c.nameAr), 'name');
}

interface ResolvedFields {
  sectionId: string;
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

/** The section, unit, cost and price a row resolves to, or the first refusal (in that order). */
function resolveFields(c: RowCells, sections: ImportSection[]): ResolvedFields | { error: ImportRowError } {
  const sectionId = resolveSection(c.categoryRaw, sections);
  if (!sectionId) return { error: 'category_invalid' };
  const unit = resolveUnit(c.unitRaw);
  if (!unit) return { error: 'unit_invalid' };

  const defaultUnitCost = readMoneyString(c.costRaw, MONEY_CELL);
  if (defaultUnitCost === null) return { error: 'cost_invalid' };
  const defaultUnitPrice = readMoneyString(c.priceRaw, MONEY_CELL);
  if (defaultUnitPrice === null) return { error: 'price_invalid' };
  return { sectionId, unit, defaultUnitCost, defaultUnitPrice };
}

function validateImportRow(
  row: string[],
  index: number,
  mapping: ColumnMapping,
  existingCodes: Set<string>,
  sections: ImportSection[],
  seen: Set<string>,
): ValidatedRow {
  const c = readCells(row, mapping);
  const refuse = (error: ImportRowError): ValidatedRow => ({ index, code: c.code, ok: false, error });
  const identity = identityError(c, existingCodes, seen);
  if (identity) return refuse(identity);
  const fields = resolveFields(c, sections);
  if ('error' in fields) return refuse(fields.error);
  return {
    index,
    code: c.code,
    ok: true,
    data: {
      code: c.code,
      nameEn: c.nameEn || null,
      nameAr: c.nameAr || null,
      ...fields,
      taxCode: cell(row, mapping.taxCode) || null,
      etaItemCode: cell(row, mapping.etaItemCode) || null,
      etaCodeType: cell(row, mapping.etaCodeType) || null,
    },
  };
}

/**
 * Validates parsed spreadsheet rows against a column mapping, the org's existing
 * codes AND its sections (the section token must resolve to one of them). Pure:
 * returns one ValidatedRow per input row (same order), each either
 * { ok:true, data } or { ok:false, error }. Insert-only — a code that already
 * exists is a per-row `code_exists`, never a whole-file failure.
 */
export function validateImportRows(
  rows: string[][],
  mapping: ColumnMapping,
  existingCodes: Set<string>,
  sections: ImportSection[],
): ValidatedRow[] {
  const seen = new Set<string>();
  const out: ValidatedRow[] = [];

  rows.forEach((row, index) => {
    const verdict = validateImportRow(row, index, mapping, existingCodes, sections, seen);
    if (verdict.ok) seen.add(verdict.code);
    out.push(verdict);
  });

  return out;
}
