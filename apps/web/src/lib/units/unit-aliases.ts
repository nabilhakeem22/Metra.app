// ONE unit alias table for both importers (price book and BOQ sheet), so a
// unit a studio writes is read the same way in both. It also accepts the
// spellings the market bulletin prints (الطن, اللفة, اللتر) and the common
// English plurals and abbreviations. Client-safe: no server import.
import type { CostItemUnit } from '@metra/db';

const UNIT_ALIASES: Record<CostItemUnit, readonly string[]> = {
  sqm: ['sqm', 'm2', 'm²', 'sq m', 'sq.m', 'square meter', 'square metre', 'متر مربع', 'متر مسطح', 'م2', 'م²'],
  linear_meter: ['linear_meter', 'linear meter', 'linear metre', 'lm', 'l.m', 'm', 'meter', 'metre', 'متر طولي', 'م.ط', 'مط'],
  pcs: ['pcs', 'pc', 'piece', 'pieces', 'no', 'nos', 'each', 'ea', 'عدد', 'قطعة'],
  lump_sum: ['lump_sum', 'lump sum', 'lumpsum', 'ls', 'sum', 'مقطوعية', 'جملة', 'إجمالي'],
  day: ['day', 'days', 'يوم', 'أيام'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'كجم', 'كغ', 'كيلو', 'الكيلو', 'كيلوجرام', 'كيلو جرام'],
  ton: ['ton', 'tons', 'tonne', 'tonnes', 'طن', 'الطن'],
  liter: ['liter', 'liters', 'litre', 'litres', 'l', 'lt', 'ltr', 'لتر', 'اللتر'],
  cbm: ['cbm', 'm3', 'm³', 'cubic meter', 'cubic metre', 'متر مكعب', 'م3', 'م³'],
  roll: ['roll', 'rolls', 'لفة', 'اللفة', 'رول'],
};

/**
 * The matching form of a unit token: lower case, no tashkeel or tatweel,
 * أ/إ/آ -> ا, ة -> ه, ى -> ي, and any run of spaces, dots, underscores or
 * hyphens as one space ('م.ط' and 'م ط' are one spelling).
 */
function unitMatchingForm(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s._-]+/g, ' ')
    .trim();
}

const UNIT_BY_FORM = new Map<string, CostItemUnit>(
  (Object.entries(UNIT_ALIASES) as Array<[CostItemUnit, readonly string[]]>).flatMap(([unit, aliases]) =>
    [unit, ...aliases].map((alias): [string, CostItemUnit] => [unitMatchingForm(alias), unit]),
  ),
);

/** The cost-item unit a spreadsheet token names, or null. */
export function unitFromToken(raw: string): CostItemUnit | null {
  const form = unitMatchingForm(raw);
  return form === '' ? null : (UNIT_BY_FORM.get(form) ?? null);
}
