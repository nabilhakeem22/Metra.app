// "Add to my price book": what the studio types, the names and code it is
// offered, and the rules the typed values keep. Pure and client-safe: the add
// form pre-checks with the same rules the server core runs again. The unit and
// the cost are NOT typed: the core takes them from the market item (its studio
// unit, its latest effective priced value).
import { itemCode } from '@metra/db/market-seed';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readTypedMoney } from '@/lib/validation/amount-field';
import { clean } from '@/lib/validation/text';
import { readFields, type FieldRead } from '@/lib/validation/field-rules';

/** Every path an add refusal can name. */
export const ADD_MARKET_ITEM_FIELDS = ['code', 'sectionId', 'defaultUnitPrice'] as const;

export type AddMarketItemField = (typeof ADD_MARKET_ITEM_FIELDS)[number];

export interface AddMarketItemInput {
  marketItemId: string;
  code: string;
  sectionId: string;
  /** Blank (both) takes the market item's own names with its spec. */
  nameAr?: string | null;
  nameEn?: string | null;
  /** Blank sells at the cost. */
  defaultUnitPrice?: string | null;
}

export interface AddMarketItemValues {
  code: string;
  sectionId: string;
  nameAr: string | null;
  nameEn: string | null;
  /** Null: the same as the cost. */
  defaultUnitPrice: string | null;
}

interface NamedMarketItem {
  key: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
}

/** The names a market item is offered under: its name and its spec, in each language. */
export function suggestedNames(item: NamedMarketItem): { nameAr: string; nameEn: string } {
  const withSpec = (name: string, spec: string | null) => (spec ? `${name} ${spec}` : name);
  return { nameAr: withSpec(item.nameAr, item.specAr), nameEn: withSpec(item.nameEn, item.specEn) };
}

/** The code it is offered under: the market seed's own (MKT-<market key>), so a seeded studio and an added item read alike. */
export function suggestedCode(item: Pick<NamedMarketItem, 'key'>): string {
  return itemCode(item.key);
}

function readCode(value: string | null | undefined): FieldRead<string> {
  const code = clean(value);
  return code ? { ok: true, value: code } : { ok: false, error: { code: 'code_required' } };
}

/** A section must be picked; whether it still exists is the core's to say (no_longer_exists). */
function readSection(value: string | null | undefined): FieldRead<string> {
  const sectionId = clean(value);
  return sectionId ? { ok: true, value: sectionId } : { ok: false, error: { code: 'required' } };
}

/** An empty price box sells at the cost; anything typed is read as every money box reads it. */
function readPrice(value: string | null | undefined): FieldRead<string | null> {
  return clean(value) === null ? { ok: true, value: null } : readTypedMoney(value);
}

/** Every typed value at once, or every refusal under its field. */
export function readAddMarketItemInput(
  input: AddMarketItemInput,
): { ok: true; values: AddMarketItemValues } | { ok: false; errors: FieldErrors<AddMarketItemField> } {
  const read = readFields({
    code: readCode(input.code),
    sectionId: readSection(input.sectionId),
    defaultUnitPrice: readPrice(input.defaultUnitPrice),
  });
  if (!read.ok) return read;
  return { ok: true, values: { ...read.values, nameAr: clean(input.nameAr), nameEn: clean(input.nameEn) } };
}
