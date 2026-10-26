// What the studio types when it records money received against a payment
// request. PURE and CLIENT-SAFE: the record dialog checks it on Save, the core
// again on arrival. The amount is read the way studios type it ("1,500",
// Arabic digits, "EGP"; owner decision Oct 8) and stored at scale 4, a fifth
// decimal refused rather than cut (A4 F8); the caps are the columns'
// (`contract_payments_text_length`).
//
// The day: not after today in Cairo, not before 2000-01-01 (readRecordedDay),
// and not before the contract was issued (dayBeforeIssue). The issue day is the
// contract's: the core reads it under the request lock, the dialog from the
// tab's view, and both say the same refusal.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readPositiveExactAmount } from '@/lib/validation/amount-field';
import { dayBeforeIssue, readRecordedDay } from '@/lib/validation/day-field';
import { readFields, readOptionalText } from '@/lib/validation/field-rules';

export const CONTRACT_PAYMENT_FIELDS = ['amount', 'receivedOn', 'method', 'reference', 'note'] as const;
export type ContractPaymentField = (typeof CONTRACT_PAYMENT_FIELDS)[number];

const MAX_PAYMENT_METHOD_CHARS = 40;
const MAX_PAYMENT_REFERENCE_CHARS = 120;
const MAX_PAYMENT_NOTE_CHARS = 500;

export interface TypedContractPayment {
  amount?: unknown;
  receivedOn?: unknown;
  method?: unknown;
  reference?: unknown;
  note?: unknown;
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `todayInCairo` is `YYYY-MM-DD`: money cannot have been received after today in Cairo. */
export function readContractPayment(input: TypedContractPayment, todayInCairo: string) {
  return readFields({
    amount: readPositiveExactAmount(input.amount, { code: 'payment_amount_invalid' }),
    receivedOn: readRecordedDay(input.receivedOn, todayInCairo),
    method: readOptionalText(asText(input.method), MAX_PAYMENT_METHOD_CHARS),
    reference: readOptionalText(asText(input.reference), MAX_PAYMENT_REFERENCE_CHARS),
    note: readOptionalText(asText(input.note), MAX_PAYMENT_NOTE_CHARS),
  });
}

export type CleanContractPayment = Extract<ReturnType<typeof readContractPayment>, { ok: true }>['values'];

/** The record dialog's pre-check: the same rules, as the refusals under each box. */
export function contractPaymentFieldErrors(
  input: TypedContractPayment,
  todayInCairo: string,
  contractIssuedOn: string,
): FieldErrors<ContractPaymentField> {
  const read = readContractPayment(input, todayInCairo);
  if (!read.ok) return read.errors;
  const beforeIssue = dayBeforeIssue(read.values.receivedOn, contractIssuedOn);
  return beforeIssue ? { receivedOn: beforeIssue } : {};
}
