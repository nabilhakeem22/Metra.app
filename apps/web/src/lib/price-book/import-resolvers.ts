// PURE price-book import section/unit resolvers. No server-only deps, no drizzle
// values. Section resolution maps a spreadsheet token to one of the org's
// `sections` (passed in); unknown tokens resolve to null and the row is REJECTED
// (category_invalid) by ./import: import never auto-creates a section.
import type { CostItemUnit } from '@metra/db';
import { unitFromToken } from '@/lib/units/unit-aliases';

export const UNIT_TOKENS: readonly CostItemUnit[] = [
  'sqm',
  'linear_meter',
  'pcs',
  'lump_sum',
  'day',
  'kg',
  'ton',
  'liter',
  'cbm',
  'roll',
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

/** The shared alias table (lib/units/unit-aliases.ts), so both importers agree. */
export function resolveUnit(text: string): CostItemUnit | null {
  return text ? unitFromToken(text) : null;
}
