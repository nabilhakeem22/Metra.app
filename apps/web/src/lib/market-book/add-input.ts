// "Add to my price book": what the studio types, the code it is offered, and
// the rules the typed values keep. Pure and client-safe: the add form
// pre-checks with the same rules the server core runs again. The code and name
// rules, and the input's shape, are every cost-item create's own
// (lib/price-book/cost-item-input). The unit, the cost and the default selling
// price are NOT typed: the core takes them from the market item, as the seed
// does (its studio unit, its newest priced month, cost x 1.05).
import { itemCode } from '@metra/db/market-seed';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readCostItemCode, readCostItemName } from '@/lib/price-book/cost-item-input';
import { readTypedMoney } from '@/lib/validation/amount-field';
import { clean } from '@/lib/validation/text';
import { readFields, type FieldRead } from '@/lib/validation/field-rules';

/** Every path an add refusal can name. */
export const ADD_MARKET_ITEM_FIELDS = ['code', 'nameAr', 'nameEn', 'sectionId', 'defaultUnitPrice'] as const;

export type AddMarketItemField = (typeof ADD_MARKET_ITEM_FIELDS)[number];

/** The add's own field beyond the ones every cost-item create takes. */
export const ADD_MARKET_ITEM_OWN_FIELDS = ['marketItemId'] as const;

export interface AddMarketItemInput {
  marketItemId: string;
  code: string;
  sectionId: string;
  /** Blank (both) takes the names the seed gives the market item. */
  nameAr?: string | null;
  nameEn?: string | null;
  /** Blank sells at the cost x 1.05, as the seed does. */
  defaultUnitPrice?: string | null;
}

export interface AddMarketItemValues {
  code: string;
  sectionId: string;
  nameAr: string | null;
  nameEn: string | null;
  /** Null: the seed's selling price for the cost. */
  defaultUnitPrice: string | null;
}

/** The code it is offered under: the market seed's own (MKT-<market key>), so a seeded studio and an added item read alike. */
export function suggestedCode(item: { key: string }): string {
  return itemCode(item.key);
}

/** A section must be picked; whether it still exists is the core's to say (no_longer_exists). */
function readSection(value: string | null | undefined): FieldRead<string> {
  const sectionId = clean(value);
  return sectionId ? { ok: true, value: sectionId } : { ok: false, error: { code: 'required' } };
}

/** An empty price box takes the seed's selling price; anything typed is read as every money box reads it. */
function readPrice(value: string | null | undefined): FieldRead<string | null> {
  return clean(value) === null ? { ok: true, value: null } : readTypedMoney(value);
}

/** Every typed value at once, or every refusal under its field. */
export function readAddMarketItemInput(
  input: AddMarketItemInput,
): { ok: true; values: AddMarketItemValues } | { ok: false; errors: FieldErrors<AddMarketItemField> } {
  return readFields({
    code: readCostItemCode(input.code),
    nameAr: readCostItemName(input.nameAr),
    nameEn: readCostItemName(input.nameEn),
    sectionId: readSection(input.sectionId),
    defaultUnitPrice: readPrice(input.defaultUnitPrice),
  });
}
