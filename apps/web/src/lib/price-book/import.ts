// PURE price-book import validator + resolvers. No server-only deps, no drizzle
// values — importable by the client preview AND vitest. Section resolution maps a
// spreadsheet token to one of the org's `sections` (passed in); unknown tokens
// are REJECTED per-row (category_invalid) — import never auto-creates a section.
import type { CostItemUnit } from '@metra/db';

export const UNIT_TOKENS: readonly CostItemUnit[] = [
  'sqm',
  'linear_meter',
  'pcs',
  'lump_sum',
  'day',
];

// Retained EN + AR aliases for the 8 seeded defaults (keyed by section.key), so
// a spreadsheet using the old category words still resolves after the unify.
const DEFAULT_SECTION_ALIASES: Record<string, string[]> = {
  civil: ['civil', 'أعمال مدنية', 'مدني'],
  gypsum: ['gypsum', 'جبس', 'جبسوم'],
  electrical: ['electrical', 'كهرباء', 'كهربائي'],
  plumbing: ['plumbing', 'سباكة'],
  joinery: ['joinery', 'نجارة'],
  finishes: ['finishes', 'تشطيبات', 'تشطيب'],
  furniture: ['furniture', 'أثاث'],
  preliminaries: ['preliminaries', 'أعمال تمهيدية', 'تمهيدية'],
};

const UNIT_ALIASES: Record<CostItemUnit, string[]> = {
  sqm: ['sqm', 'm2', 'm²', 'متر مربع', 'م2', 'م²'],
  linear_meter: ['linear_meter', 'linear meter', 'lm', 'متر طولي', 'م.ط'],
  pcs: ['pcs', 'pc', 'piece', 'قطعة', 'عدد'],
  lump_sum: ['lump_sum', 'lump sum', 'ls', 'مقطوعية', 'إجمالي'],
  day: ['day', 'يوم'],
};

function buildLookup<T extends string>(
  aliases: Record<T, string[]>,
): Map<string, T> {
  const m = new Map<string, T>();
  for (const key of Object.keys(aliases) as T[]) {
    for (const alias of aliases[key]) m.set(norm(alias), key);
  }
  return m;
}

const UNIT_LOOKUP = buildLookup(UNIT_ALIASES);

// §4.1 Arabic normalization so plain/hamza'd forms match: fold alef variants,
// taa-marbuta -> haa, alef-maqsura -> yaa, and drop tashkeel + tatweel.
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[ً-ْ]/g, '') // tashkeel (harakat)
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآ]/g, 'ا') // أ إ آ -> ا
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ى/g, 'ي'); // ى -> ي
}

/** The minimal shape resolveSection needs — a row from listSections. */
export interface ImportSection {
  id: string;
  key: string | null;
  nameEn: string | null;
  nameAr: string | null;
}

/**
 * Resolve a spreadsheet section token to one of the org's section ids. Matches
 * (case/whitespace/Arabic-normalized) against each section's key, English name
 * and Arabic name, then falls back to the retained aliases for the 8 defaults.
 * Returns null for an unknown token (the row becomes category_invalid).
 */
export function resolveSection(
  text: string,
  sections: ImportSection[],
): string | null {
  if (!text) return null;
  const n = norm(text);
  for (const s of sections) {
    if (s.key && norm(s.key) === n) return s.id;
    if (s.nameEn && norm(s.nameEn) === n) return s.id;
    if (s.nameAr && norm(s.nameAr) === n) return s.id;
  }
  for (const s of sections) {
    if (s.key && DEFAULT_SECTION_ALIASES[s.key]?.some((a) => norm(a) === n)) {
      return s.id;
    }
  }
  return null;
}

export function resolveUnit(text: string): CostItemUnit | null {
  if (!text) return null;
  return UNIT_LOOKUP.get(norm(text)) ?? null;
}

export type ImportRowError =
  | 'row_empty'
  | 'code_missing'
  | 'code_duplicate_in_file'
  | 'code_exists'
  | 'name_missing'
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

export interface ParsedCostItem {
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

// STRICT money parse. Accepts ONLY: (a) a plain non-negative decimal, or
// (b) comma-as-thousands grouping (then strips the grouping commas). Everything
// else -> null (the row becomes cost_invalid/price_invalid). This deliberately
// rejects ambiguous separators like "1,5" / "1.234,56" / "1,2,3", as well as
// negatives, ".5", "1.", "1e3", currency prefixes, and Arabic-Indic digits
// (\d is ASCII-only). Blank -> "0".
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const GROUPED_DECIMAL = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

function parseMoney(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return '0';
  if (PLAIN_DECIMAL.test(s)) return s;
  if (GROUPED_DECIMAL.test(s)) return s.replace(/,/g, '');
  return null;
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
    const code = cell(row, mapping.code);
    const nameEn = cell(row, mapping.nameEn);
    const nameAr = cell(row, mapping.nameAr);
    const categoryRaw = cell(row, mapping.category);
    const unitRaw = cell(row, mapping.unit);
    const costRaw = cell(row, mapping.cost);
    const priceRaw = cell(row, mapping.price);

    const anyFilled =
      code || nameEn || nameAr || categoryRaw || unitRaw || costRaw || priceRaw;

    const fail = (error: ImportRowError): void => {
      out.push({ index, code, ok: false, error });
    };

    if (!anyFilled) return fail('row_empty');
    if (!code) return fail('code_missing');
    // Case-SENSITIVE: the DB unique(org_id, code) is case-sensitive, so `ABC`
    // and `abc` are distinct codes and must not be collapsed here.
    if (seen.has(code)) return fail('code_duplicate_in_file');
    if (existingCodes.has(code)) return fail('code_exists');
    if (!nameEn && !nameAr) return fail('name_missing');

    const sectionId = resolveSection(categoryRaw, sections);
    if (!sectionId) return fail('category_invalid');
    const unit = resolveUnit(unitRaw);
    if (!unit) return fail('unit_invalid');

    const defaultUnitCost = parseMoney(costRaw);
    if (defaultUnitCost === null) return fail('cost_invalid');
    const defaultUnitPrice = parseMoney(priceRaw);
    if (defaultUnitPrice === null) return fail('price_invalid');

    seen.add(code);
    out.push({
      index,
      code,
      ok: true,
      data: {
        code,
        nameEn: nameEn || null,
        nameAr: nameAr || null,
        sectionId,
        unit,
        defaultUnitCost,
        defaultUnitPrice,
        taxCode: cell(row, mapping.taxCode) || null,
        etaItemCode: cell(row, mapping.etaItemCode) || null,
        etaCodeType: cell(row, mapping.etaCodeType) || null,
      },
    });
  });

  return out;
}
