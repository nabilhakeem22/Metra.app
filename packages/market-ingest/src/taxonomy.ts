// The market taxonomy: the bulletin's own table of contents, 8 tops in the
// owner's display order (D8, interior first) and their leaves. Changing it is a
// PR, never a session decision: B4 refuses any sub-category not listed here.
// Data module, so it is longer than the 150-line guide by design.

export interface CategoryDefinition {
  key: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

type Leaf = [key: string, nameAr: string, nameEn: string];
type Top = { key: string; nameAr: string; nameEn: string; leaves: Leaf[] };

const TOPS: Top[] = [
  { key: 'finishing', nameAr: 'خامات التشطيب', nameEn: 'Finishing materials', leaves: [
    ['wood', 'الأخشاب', 'Wood'],
    ['aluminium', 'الألومنيوم', 'Aluminium'],
    ['upvc', 'قطاعات UPVC', 'UPVC profiles'],
    ['glass', 'الزجاج', 'Glass'],
    ['gypsum_boards', 'ألواح الجبس', 'Gypsum boards'],
    ['suspended_ceilings', 'الأسقف المعلقة', 'Suspended ceilings'],
    ['lightweight_boards', 'الألواح الخفيفة', 'Lightweight boards'],
  ] },
  { key: 'cladding', nameAr: 'التكسيات', nameEn: 'Cladding and flooring', leaves: [
    ['tiles', 'البلاط', 'Tiles'],
    ['ceramics', 'السيراميك', 'Ceramics'],
    ['marble', 'الرخام', 'Marble'],
    ['granite', 'الجرانيت', 'Granite'],
    ['epoxy_grouts', 'روبة الإيبوكسي', 'Epoxy grouts'],
    ['hdf_flooring', 'أرضيات HDF', 'HDF flooring'],
    ['vinyl_flooring', 'أرضيات الفينيل', 'Vinyl flooring'],
    ['roof_tiles', 'القرميد', 'Roof tiles'],
    ['cladding_panels', 'ألواح التكسية', 'Cladding panels'],
    ['facade_base', 'أسفل الواجهات والأسوار', 'Facade and fence base cladding'],
  ] },
  { key: 'paints', nameAr: 'الدهانات', nameEn: 'Paints', leaves: [
    ['cementitious_facade', 'دهانات الواجهات الأسمنتية', 'Cementitious facade paints'],
    ['decorative_plaster', 'البياض الديكوري', 'Decorative plaster'],
    ['wall_putty', 'المعجون', 'Wall putty'],
    ['plastic', 'دهانات البلاستيك', 'Plastic (emulsion) paints'],
    ['primer', 'البرايمر', 'Primers'],
    ['alkyd', 'اللاكيه', 'Alkyd (lacquer) paints'],
    ['varnish_sealers', 'دهان الاستر والورنيش', 'Sealers and varnishes'],
  ] },
  { key: 'electrical', nameAr: 'مستلزمات الكهرباء', nameEn: 'Electrical supplies', leaves: [
    ['wires', 'الأسلاك', 'Wires'],
    ['cables', 'الكابلات', 'Cables'],
    ['flexible_conduits', 'الخراطيم المرنة', 'Flexible conduits'],
    ['conduits', 'مواسير الكهرباء', 'Conduits'],
    ['fittings', 'مستلزمات التركيب', 'Fittings'],
  ] },
  { key: 'pipes', nameAr: 'المواسير', nameEn: 'Pipes', leaves: [
    ['supply_galvanized', 'مواسير تغذية مجلفنة', 'Galvanized supply pipes'],
    ['supply_ppr', 'مواسير تغذية PPR', 'PPR supply pipes'],
    ['supply_pvc', 'مواسير تغذية PVC', 'PVC supply pipes'],
    ['drainage_white_plastic', 'مواسير صرف بلاستيك أبيض', 'White plastic drainage pipes'],
    ['drainage_pp_gasket', 'مواسير صرف PP بجوان', 'PP gasketed drainage pipes'],
    ['drainage_manholes', 'غرف التفتيش', 'Drainage manholes'],
    ['drainage_clay_standard', 'مواسير صرف فخار عادية', 'Standard clay drainage pipes'],
    ['drainage_clay_flexible', 'مواسير صرف فخار بوصلات مرنة', 'Flexible-joint clay drainage pipes'],
  ] },
  { key: 'insulation', nameAr: 'المواد العازلة', nameEn: 'Insulation', leaves: [
    ['waterproofing', 'العزل المائي', 'Waterproofing'],
    ['thermal', 'العزل الحراري', 'Thermal insulation'],
  ] },
  { key: 'raw', nameAr: 'الخامات الأساسية', nameEn: 'Basic materials', leaves: [
    ['steel', 'الحديد', 'Steel'],
    ['cement', 'الأسمنت', 'Cement'],
    ['ready_mix_concrete', 'الخرسانة الجاهزة', 'Ready-mix concrete'],
    ['concrete_admixtures', 'إضافات الخرسانة', 'Concrete admixtures'],
    ['repair_materials', 'مواد الترميم', 'Repair materials'],
    ['joint_fillers', 'مواد ملء الفواصل', 'Joint fillers'],
    ['bricks', 'الطوب', 'Bricks'],
    ['aggregates', 'الركام', 'Aggregates'],
    ['gypsum', 'الجبس', 'Gypsum'],
    ['lime', 'الجير', 'Lime'],
  ] },
  { key: 'roads', nameAr: 'طرق وكباري', nameEn: 'Roads and bridges', leaves: [
    ['steel_sheets', 'ألواح الصلب', 'Steel sheets'],
    ['base_layers', 'طبقات الأساس', 'Base layers'],
    ['binders', 'مواد الربط', 'Binders'],
    ['bearings_joints', 'الركائز والفواصل', 'Bearings and joints'],
    ['marking_paints', 'دهانات علامات الطرق', 'Road marking paints'],
    ['crossing_pipes', 'مواسير العبور', 'Crossing pipes'],
  ] },
];

export const TOP_CATEGORIES: CategoryDefinition[] = TOPS.map((top, index) => ({
  key: top.key,
  nameAr: top.nameAr,
  nameEn: top.nameEn,
  sortOrder: index + 1,
}));

export const LEAF_CATEGORIES: CategoryDefinition[] = TOPS.flatMap((top) =>
  top.leaves.map(([leaf, nameAr, nameEn], index) => ({
    key: `${top.key}.${leaf}`,
    nameAr,
    nameEn,
    sortOrder: index + 1,
  })),
);

const LEAF_KEYS = new Set(LEAF_CATEGORIES.map((leaf) => leaf.key));

export function isLeafCategory(key: string): boolean {
  return LEAF_KEYS.has(key);
}

/** The top of a leaf key: 'finishing.glass' -> 'finishing'. */
export function topOf(leafKey: string): string {
  return leafKey.slice(0, leafKey.indexOf('.'));
}

/** Every category a set of leaves needs, tops first, in display order. */
export function categoriesFor(leafKeys: Iterable<string>): CategoryDefinition[] {
  const leaves = new Set(leafKeys);
  const tops = new Set([...leaves].map(topOf));
  return [
    ...TOP_CATEGORIES.filter((top) => tops.has(top.key)),
    ...LEAF_CATEGORIES.filter((leaf) => leaves.has(leaf.key)),
  ];
}
