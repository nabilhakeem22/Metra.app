// Shared seed source for the per-tenant `sections` table. Used by BOTH the 0013
// migration (to backfill/seed existing orgs) and createOrgCore (new orgs), so a
// section a tenant has always maps 1:1 to its old cost-item category `key`.
// Labels mirror the retired priceBook.categories i18n strings. Western numerals.

export const DEFAULT_SECTION_KEYS = [
  'civil',
  'gypsum',
  'electrical',
  'plumbing',
  'joinery',
  'finishes',
  'furniture',
  'preliminaries',
] as const;

export type DefaultSectionKey = (typeof DEFAULT_SECTION_KEYS)[number];

/** Bilingual display labels for each seeded default (en + ar). */
export const DEFAULT_SECTION_LABELS: Record<
  DefaultSectionKey,
  { en: string; ar: string }
> = {
  civil: { en: 'Civil', ar: 'أعمال مدنية' },
  gypsum: { en: 'Gypsum', ar: 'جبس' },
  electrical: { en: 'Electrical', ar: 'كهرباء' },
  plumbing: { en: 'Plumbing', ar: 'سباكة' },
  joinery: { en: 'Joinery', ar: 'نجارة' },
  finishes: { en: 'Finishes', ar: 'تشطيبات' },
  furniture: { en: 'Furniture', ar: 'أثاث' },
  preliminaries: { en: 'Preliminaries', ar: 'أعمال تمهيدية' },
};

/** The 8 defaults as insert rows (name pair + key), order-stable. */
export const DEFAULT_SECTIONS = DEFAULT_SECTION_KEYS.map((key) => ({
  key,
  nameEn: DEFAULT_SECTION_LABELS[key].en,
  nameAr: DEFAULT_SECTION_LABELS[key].ar,
}));
