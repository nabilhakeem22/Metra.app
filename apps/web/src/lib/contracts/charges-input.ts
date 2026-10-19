// The two rates a studio sets on an execution contract: VAT and the supervision
// fee, each a percentage of the BOQ total. PURE and CLIENT-SAFE, so the Generate
// dialog, the Charges form and the server cores refuse the same value under the
// same box.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readFields, readMoneyField, type FieldRead } from '@/lib/validation/field-rules';
import { isPercentInRange } from '@/lib/validation/percent';
import { requiredText } from '@/lib/validation/text-field-rules';

export const CONTRACT_CHARGE_FIELDS = ['taxRate', 'supervisionPct'] as const;
export type ContractChargeField = (typeof CONTRACT_CHARGE_FIELDS)[number];

/** The rates as typed. Directly invokable, so anything may arrive. */
export interface ContractChargesInput {
  taxRate?: unknown;
  supervisionPct?: unknown;
}

/** The rates as stored: canonical decimals inside 0 to 100. */
export interface ContractChargeRates {
  taxRate: string;
  supervisionPct: string;
}

/** What the Generate dialog opens with: Egyptian VAT, and no supervision fee. */
export const DEFAULT_CONTRACT_CHARGES: ContractChargeRates = { taxRate: '14', supervisionPct: '0' };

/** One rate: required, a number, from 0 to 100. */
function readRate(raw: unknown): FieldRead<string> {
  if (typeof raw !== 'string') return { ok: false, error: { code: 'required' } };
  const missing = requiredText(raw);
  if (missing) return { ok: false, error: missing };
  const read = readMoneyField(raw, {});
  if (!read.ok) return read;
  if (!isPercentInRange(read.value)) {
    return { ok: false, error: { code: 'out_of_range', params: { min: 0, max: 100 } } };
  }
  return read;
}

export function readContractCharges(
  input: ContractChargesInput,
): { ok: true; values: ContractChargeRates } | { ok: false; errors: FieldErrors<ContractChargeField> } {
  return readFields({ taxRate: readRate(input.taxRate), supervisionPct: readRate(input.supervisionPct) });
}

/** The form's pre-check: the same rules, as the refusals under each box. */
export function contractChargeFieldErrors(input: ContractChargesInput): FieldErrors<ContractChargeField> {
  const read = readContractCharges(input);
  return read.ok ? {} : read.errors;
}
