// What every cost-item create reads first, whoever creates it: the price book's
// own form (./field-rules.ts) and the market book's "add to my price book"
// (lib/market-book/add-input.ts). Pure and client-safe: the form's pre-check
// and the server core run the same rules.
//
// A server action takes whatever object the client sends, so a field typed as
// a string can arrive as a number, an object or an array; `.trim()` on it
// would throw past the core (answered `generic`, logged as a defect). The
// shape check refuses that input as `malformed` before any rule reads it.
import { readOptionalText, type FieldRead } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';

/** The longest code a cost item may be given, in characters (code points). */
export const COST_ITEM_CODE_MAX = 120;
/** The longest name, in each language: BOQ descriptions run long, Arabic ones especially. */
export const COST_ITEM_NAME_MAX = 1_000;

/** The text fields a cost item already holds; an update leaves an unchanged one as it is, whatever it holds. */
export interface StoredCostItemText {
  code: string;
  nameEn: string | null;
  nameAr: string | null;
}

/** The text every cost-item create takes: its code, its two names, its section and its selling price. */
const COST_ITEM_TEXT_FIELDS = ['code', 'nameEn', 'nameAr', 'sectionId', 'defaultUnitPrice'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Absent, null, or a string. */
const isOptionalText = (value: unknown) => value === undefined || value === null || typeof value === 'string';

/**
 * Whether `input` is an object whose shared cost-item fields, and each of the
 * writer's own `extraFields`, are a string, null or absent. The caller answers
 * `malformed` when it is not, and never reads the input further.
 */
export function hasCostItemInputShape(input: unknown, extraFields: readonly string[]): boolean {
  if (!isObject(input)) return false;
  return [...COST_ITEM_TEXT_FIELDS, ...extraFields].every((field) => isOptionalText(input[field]));
}

/**
 * A text box read under `max`, unless it still holds the value the item
 * already has (`stored`): an item imported before the caps, or with a long
 * description, keeps its text through an edit that changes something else.
 */
function readBoundedText(value: string | null | undefined, max: number, stored: string | null | undefined): FieldRead<string | null> {
  const typed = clean(value);
  if (stored !== undefined && typed !== null && typed === stored) return { ok: true, value: typed };
  return readOptionalText(value, max);
}

/** The code: required, printable, at most COST_ITEM_CODE_MAX characters (an unchanged stored code passes). */
export function readCostItemCode(value: string | null | undefined, stored?: string): FieldRead<string> {
  const read = readBoundedText(value, COST_ITEM_CODE_MAX, stored);
  if (!read.ok) return read;
  return read.value === null ? { ok: false, error: { code: 'code_required' } } : { ok: true, value: read.value };
}

/** One of the two names: blank is null; printable, at most COST_ITEM_NAME_MAX characters (an unchanged stored name passes). */
export function readCostItemName(value: string | null | undefined, stored?: string | null): FieldRead<string | null> {
  return readBoundedText(value, COST_ITEM_NAME_MAX, stored);
}
