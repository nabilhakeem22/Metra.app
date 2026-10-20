// What the studio types when it records money received against a payment
// request. PURE and CLIENT-SAFE: the record dialog checks it on Save, the core
// again on arrival. The amount is read the way studios type it ("1,500",
// Arabic digits, "EGP"; owner decision Oct 8) and stored at scale 4, a fifth
// decimal refused rather than cut (A4 F8); the caps are the columns'
// (`contract_payments_text_length`).
//
// The day: not after today in Cairo, not before 2000-01-01 (a two-digit year
// typed into the date box reads as 0026, A4 F5), and not before the contract
// was issued. The issue day is the contract's: the core reads it under the
// request lock, the dialog from the tab's view, and both say the same refusal.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { formatDate } from '@/lib/format/date';
import { readPositiveExactAmount } from '@/lib/validation/amount-field';
import { readDayUpToToday } from '@/lib/validation/day-field';
import { readFields, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';

export const CONTRACT_PAYMENT_FIELDS = ['amount', 'receivedOn', 'method', 'reference', 'note'] as const;
export type ContractPaymentField = (typeof CONTRACT_PAYMENT_FIELDS)[number];

export const MAX_PAYMENT_METHOD_CHARS = 40;
export const MAX_PAYMENT_REFERENCE_CHARS = 120;
export const MAX_PAYMENT_NOTE_CHARS = 500;

/** No studio received this contract's money before this day: an earlier one is a typo. */
const FIRST_PAYMENT_DAY = '2000-01-01';

export interface TypedContractPayment {
  amount?: unknown;
  receivedOn?: unknown;
  method?: unknown;
  reference?: unknown;
  note?: unknown;
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function readReceivedOn(raw: unknown, todayInCairo: string): FieldRead<string> {
  const read = readDayUpToToday(raw, todayInCairo);
  if (read.ok && read.value < FIRST_PAYMENT_DAY) return { ok: false, error: { code: 'invalid_date' } };
  return read;
}

/** `todayInCairo` is `YYYY-MM-DD`: money cannot have been received after today in Cairo. */
export function readContractPayment(input: TypedContractPayment, todayInCairo: string) {
  return readFields({
    amount: readPositiveExactAmount(input.amount, { code: 'payment_amount_invalid' }),
    receivedOn: readReceivedOn(input.receivedOn, todayInCairo),
    method: readOptionalText(asText(input.method), MAX_PAYMENT_METHOD_CHARS),
    reference: readOptionalText(asText(input.reference), MAX_PAYMENT_REFERENCE_CHARS),
    note: readOptionalText(asText(input.note), MAX_PAYMENT_NOTE_CHARS),
  });
}

export type CleanContractPayment = Extract<ReturnType<typeof readContractPayment>, { ok: true }>['values'];

/**
 * A payment dated before its contract was issued, as the refusal under the day
 * (`date_before_issue`, the issue day as the app shows every date, as A3's
 * paper signature says it), or null. Both `YYYY-MM-DD`.
 */
export function receivedBeforeIssue(receivedOn: string, issuedOn: string): FieldError | null {
  return receivedOn < issuedOn ? { code: 'date_before_issue', params: { date: formatDate(issuedOn, 'en') } } : null;
}

/** The record dialog's pre-check: the same rules, as the refusals under each box. */
export function contractPaymentFieldErrors(
  input: TypedContractPayment,
  todayInCairo: string,
  contractIssuedOn: string,
): FieldErrors<ContractPaymentField> {
  const read = readContractPayment(input, todayInCairo);
  if (!read.ok) return read.errors;
  const beforeIssue = receivedBeforeIssue(read.values.receivedOn, contractIssuedOn);
  return beforeIssue ? { receivedOn: beforeIssue } : {};
}
