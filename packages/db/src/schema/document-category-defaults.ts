// Shared seed source for the per-tenant `document_categories` table — used by BOTH
// the 0040 migration backfill (every org that already exists) and createOrgCore
// (every org created from here on), exactly like stage-defaults.ts.
//
// A firm can rename, reorder, deactivate or add to these; they are a starting point,
// not a fixed vocabulary. The `key` is stable and machine-readable so a default can
// be recognised later (for translation, or to avoid double-seeding); a firm's own
// categories carry a null key.

export const DEFAULT_DOCUMENT_CATEGORY_KEYS = [
  'contract',
  'commercial',
  'drawings',
  'correspondence',
  'invoices',
  'other',
] as const;

export type DefaultDocumentCategoryKey =
  (typeof DEFAULT_DOCUMENT_CATEGORY_KEYS)[number];

/** Bilingual labels. Arabic is the primary locale, so it is written the way an
 *  Egyptian fit-out office actually files paper, not translated from the English. */
export const DEFAULT_DOCUMENT_CATEGORY_LABELS: Record<
  DefaultDocumentCategoryKey,
  { en: string; ar: string }
> = {
  contract: { en: 'Contracts', ar: 'العقود' },
  commercial: { en: 'Commercial & tax', ar: 'مستندات تجارية وضريبية' },
  drawings: { en: 'Drawings', ar: 'الرسومات' },
  correspondence: { en: 'Correspondence', ar: 'المراسلات' },
  invoices: { en: 'Invoices', ar: 'الفواتير' },
  other: { en: 'Other', ar: 'أخرى' },
};

/** The rows a fresh org starts with, in display order. */
export function defaultDocumentCategories(): Array<{
  key: DefaultDocumentCategoryKey;
  nameEn: string;
  nameAr: string;
  sortOrder: number;
}> {
  return DEFAULT_DOCUMENT_CATEGORY_KEYS.map((key, i) => ({
    key,
    nameEn: DEFAULT_DOCUMENT_CATEGORY_LABELS[key].en,
    nameAr: DEFAULT_DOCUMENT_CATEGORY_LABELS[key].ar,
    sortOrder: i,
  }));
}
