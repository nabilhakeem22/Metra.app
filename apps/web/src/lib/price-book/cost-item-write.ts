// What a cost-item create or update checks before it writes, and how a write
// the database refuses is answered. Server-side (it reads the org's sections and
// items in the caller's transaction); the typed-value rules it starts from are
// the client-safe ./field-rules. Shared by every cost-item writer: the price
// book's own form and the market book's "add to my price book".
import { costItems, sections, type CostItemUnit, type MetraDb } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { isUuid } from '@/lib/uuid';
import { clean } from '@/lib/validation/text';
import { hasCostItemInputShape } from './cost-item-input';
import { readCostItemInput, type CostItemValues } from './field-rules';
import type { CostItemInput } from './fields';
import { UNIT_TOKENS } from './import';

/** A race the read checks in requireWritable can lose, or a CHECK the typed-
 *  value rules already enforce, each answered under its own field. */
export const COST_ITEM_REFUSALS = [
  { constraint: 'cost_items_org_id_code_unique', field: 'code', error: { code: 'code_taken' } },
  {
    constraint: 'cost_items_section_same_org_fk',
    field: 'sectionId',
    error: { code: 'no_longer_exists' },
  },
  {
    constraint: 'cost_items_default_unit_cost_nonneg',
    field: 'defaultUnitCost',
    error: { code: 'not_negative' },
  },
  {
    constraint: 'cost_items_default_unit_price_nonneg',
    field: 'defaultUnitPrice',
    error: { code: 'not_negative' },
  },
] as const satisfies readonly ConstraintRefusal[];

function isUnit(v: unknown): v is CostItemUnit {
  return UNIT_TOKENS.includes(v as CostItemUnit);
}

/** A cost item's row, as written. */
export interface CostItemColumns extends CostItemValues {
  sectionId: string;
  unit: CostItemUnit;
  taxCode: string | null;
  etaItemCode: string | null;
  etaCodeType: string | null;
}

/** The price book's own fields beyond the ones every cost-item create takes. */
const PRICE_BOOK_INPUT_FIELDS = ['unit', 'defaultUnitCost', 'taxCode', 'etaItemCode', 'etaCodeType'] as const;

/** The row's columns, or the refusal: an input no form can send (not an object,
 *  a field that is not text), then every typed-value error at once, then the
 *  values no form can send (a section id that is not a uuid, an unknown unit). */
export function costItemColumns(
  input: CostItemInput,
): { refusal: ActionResult } | { columns: CostItemColumns } {
  if (!hasCostItemInputShape(input, PRICE_BOOK_INPUT_FIELDS)) return { refusal: err('malformed') };
  const read = readCostItemInput(input);
  if (!read.ok) return { refusal: fieldsFailed(read.errors) };
  if (!isUuid(input.sectionId) || !isUnit(input.unit)) return { refusal: err('malformed') };
  return {
    columns: {
      ...read.values,
      sectionId: input.sectionId,
      unit: input.unit,
      taxCode: clean(input.taxCode),
      etaItemCode: clean(input.etaItemCode),
      etaCodeType: clean(input.etaCodeType),
    },
  };
}

/**
 * The org-scoped facts a write depends on: the chosen section still exists in
 * THIS org (RLS-scoped tx), and no OTHER item has the code. A concurrent insert
 * of the same code that slips past this read is the unique index's to refuse.
 */
export async function requireWritable(
  tx: MetraDb,
  write: { sectionId: string; code: string; exceptId?: string },
): Promise<void> {
  const [section] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.id, write.sectionId))
    .limit(1);
  if (!section) failFields({ sectionId: { code: 'no_longer_exists' } });

  const sameCode = eq(costItems.code, write.code);
  const [dup] = await tx
    .select({ id: costItems.id })
    .from(costItems)
    .where(write.exceptId ? and(sameCode, ne(costItems.id, write.exceptId)) : sameCode)
    .limit(1);
  if (dup) failFields({ code: { code: 'code_taken' } });
}
