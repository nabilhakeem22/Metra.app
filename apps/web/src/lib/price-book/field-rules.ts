// The rules a cost item's typed values must keep. Pure and client-safe: the
// form runs them before sending, and the core runs them again on what arrived.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { clean } from '@/lib/validation/text';
import { readTypedMoney } from '@/lib/validation/amount-field';
import { collectFieldErrors } from '@/lib/validation/field-rules';
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

/** Read every typed value at once, or say what is wrong with each of them. */
export function readCostItemInput(input: CostItemInput): CostItemRead {
  const code = clean(input.code);
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  const cost = readTypedMoney(input.defaultUnitCost, BLANK_IS_ZERO);
  const price = readTypedMoney(input.defaultUnitPrice, BLANK_IS_ZERO);
  if (code && (nameEn || nameAr) && cost.ok && price.ok) {
    return {
      ok: true,
      values: { code, nameEn, nameAr, defaultUnitCost: cost.value, defaultUnitPrice: price.value },
    };
  }
  return {
    ok: false,
    errors: collectFieldErrors({
      code: code ? null : { code: 'code_required' },
      name: nameEn || nameAr ? null : { code: 'name_required' },
      defaultUnitCost: cost.ok ? null : cost.error,
      defaultUnitPrice: price.ok ? null : price.error,
    }),
  };
}

/** The form's pre-check: the same rules, as the refusals under each field. */
export function costItemFieldErrors(input: CostItemInput): FieldErrors<CostItemField> {
  const read = readCostItemInput(input);
  return read.ok ? {} : read.errors;
}
