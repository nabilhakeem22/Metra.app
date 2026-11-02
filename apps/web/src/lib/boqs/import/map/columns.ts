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

/**
 * The header text Metra CALLS each column — the canonical spelling of its first
 * alias above.
 *
 * The downloaded template writes exactly these strings (`../template.ts` imports
 * this table), and `autoDetectMapping` matches them, so they are the one
 * spelling that is both what a studio sees across the top of their sheet and
 * what this file expects. A missing-column message names THESE, never the field
 * identifiers: "ناقص عمود: unitPrice" asks an Arabic-first studio to match a
 * camelCase word against a spreadsheet that has never contained one.
 */
export const CANONICAL_HEADERS: Record<ImportField, string> = {
  itemCode: 'Item',
  section: 'Section',
  description: 'Description',
  unit: 'Unit',
  qty: 'Qty',
  unitPrice: 'Unit price',
  unitCost: 'Unit cost',
  provisional: 'Provisional',
  costItemCode: 'Price book',
};

/** Fields without which a row cannot become a line. */
export const REQUIRED: ImportField[] = ['description', 'unit', 'qty', 'unitPrice'];

export const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, ' ');

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
