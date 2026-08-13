// Shared seed source for the per-tenant `project_types` table. Used by BOTH the
// 0015 migration backfill and createOrgCore. Labels bilingual; Western numerals.

export const DEFAULT_PROJECT_TYPE_KEYS = [
  'villa',
  'apartment',
  'office',
  'retail',
  'restaurant',
] as const;

export type DefaultProjectTypeKey = (typeof DEFAULT_PROJECT_TYPE_KEYS)[number];

export const DEFAULT_PROJECT_TYPE_LABELS: Record<
  DefaultProjectTypeKey,
  { en: string; ar: string }
> = {
  villa: { en: 'Villa', ar: 'فيلا' },
  apartment: { en: 'Apartment', ar: 'شقة' },
  office: { en: 'Office', ar: 'مكتب' },
  retail: { en: 'Retail', ar: 'محل تجاري' },
  restaurant: { en: 'Restaurant', ar: 'مطعم' },
};

/** The 5 defaults as insert rows (key + name pair + sort), order-stable. */
export const DEFAULT_PROJECT_TYPES = DEFAULT_PROJECT_TYPE_KEYS.map(
  (key, i) => ({
    key,
    nameEn: DEFAULT_PROJECT_TYPE_LABELS[key].en,
    nameAr: DEFAULT_PROJECT_TYPE_LABELS[key].ar,
    sortOrder: i,
  }),
);
