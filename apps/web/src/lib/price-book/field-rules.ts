// The rules a cost item's typed values must keep. Pure and client-safe: the
// form runs them before sending, and the core runs them again on what arrived.
// The code and name rules are every cost-item writer's own (./cost-item-input).
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readTypedMoney } from '@/lib/validation/amount-field';
import { readFields } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';
import { readCostItemCode, readCostItemName } from './cost-item-input';
import type { CostItemField, CostItemInput } from './fields';

/** A cleared cost/price box is a zero rather than a refusal (the column is NOT
 *  NULL); the figure is read as every money box reads it (amount-field.ts). */
const BLANK_IS_ZERO = '0';

/** The typed values as the database stores them. */
export interface CostItemValues {
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

export type CostItemRead =
  | { ok: true; values: CostItemValues }
  | { ok: false; errors: FieldErrors<CostItemField> };

/** Read every typed value at once, or say what is wrong with each of them; one of the two names is enough (`name`). */
export function readCostItemInput(input: CostItemInput): CostItemRead {
  const read = readFields({
    code: readCostItemCode(input.code),
    nameEn: readCostItemName(input.nameEn),
    nameAr: readCostItemName(input.nameAr),
    defaultUnitCost: readTypedMoney(input.defaultUnitCost, BLANK_IS_ZERO),
    defaultUnitPrice: readTypedMoney(input.defaultUnitPrice, BLANK_IS_ZERO),
  });
  const named = clean(input.nameEn) !== null || clean(input.nameAr) !== null;
  if (read.ok && named) return read;
  return { ok: false, errors: { ...(read.ok ? {} : read.errors), ...(named ? {} : { name: { code: 'name_required' } }) } };
}

/** The form's pre-check: the same rules, as the refusals under each field. */
export function costItemFieldErrors(input: CostItemInput): FieldErrors<CostItemField> {
  const read = readCostItemInput(input);
  return read.ok ? {} : read.errors;
}
