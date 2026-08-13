// Shared seed source for the per-tenant `stage_templates` table AND the initial
// `project_stages` a new project copies. The default 10-stage fit-out sequence.
// Used by the 0015 migration backfill and createOrgCore. Bilingual labels.

export const DEFAULT_STAGE_KEYS = [
  'design_drawings',
  'civil_demolition',
  'mep_first_fix',
  'gypsum_plaster',
  'flooring_tiling',
  'painting_finishes',
  'joinery',
  'mep_second_fix',
  'snagging',
  'handover',
] as const;

export type DefaultStageKey = (typeof DEFAULT_STAGE_KEYS)[number];

export const DEFAULT_STAGE_LABELS: Record<
  DefaultStageKey,
  { en: string; ar: string }
> = {
  design_drawings: { en: 'Design & drawings', ar: 'التصميم والرسومات' },
  civil_demolition: { en: 'Civil & demolition', ar: 'الأعمال المدنية والهدم' },
  mep_first_fix: { en: 'MEP first fix', ar: 'التمديدات الأولية' },
  gypsum_plaster: { en: 'Gypsum & plaster', ar: 'الجبس والمحارة' },
  flooring_tiling: { en: 'Flooring & tiling', ar: 'الأرضيات والبلاط' },
  painting_finishes: { en: 'Painting & finishes', ar: 'الدهانات والتشطيبات' },
  joinery: { en: 'Joinery', ar: 'النجارة' },
  mep_second_fix: { en: 'MEP second fix', ar: 'التمديدات النهائية' },
  snagging: { en: 'Snagging', ar: 'المعالجات' },
  handover: { en: 'Handover', ar: 'التسليم' },
};

/** The 10 stages as insert rows (key + name pair + sort), order-stable. */
export const DEFAULT_STAGE_TEMPLATES = DEFAULT_STAGE_KEYS.map((key, i) => ({
  key,
  nameEn: DEFAULT_STAGE_LABELS[key].en,
  nameAr: DEFAULT_STAGE_LABELS[key].ar,
  sortOrder: i,
}));
