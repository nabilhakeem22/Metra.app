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
import { MAX_LABEL_CHARS } from '@/lib/validation/text';

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

/** The code: required, printable, at most MAX_LABEL_CHARS characters. */
export function readCostItemCode(value: string | null | undefined): FieldRead<string> {
  const read = readOptionalText(value, MAX_LABEL_CHARS);
  if (!read.ok) return read;
  return read.value === null ? { ok: false, error: { code: 'code_required' } } : { ok: true, value: read.value };
}

/** One of the two names: blank is null; printable, at most MAX_LABEL_CHARS characters. */
export function readCostItemName(value: string | null | undefined): FieldRead<string | null> {
  return readOptionalText(value, MAX_LABEL_CHARS);
}
