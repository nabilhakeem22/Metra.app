// The typed half of recording a payment: the amount, and the optional method,
// reference and note. Pure and client-safe: the payment forms run it on submit
// and normalizePayment runs it again on arrival.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readPositiveAmount } from '@/lib/validation/amount-field';
import {
  readFields,
  readOptionalText,
  type FieldRead,
} from '@/lib/validation/field-rules';
import { MAX_LABEL_CHARS, MAX_NOTE_CHARS } from '@/lib/validation/text';

export const PAYMENT_FIELDS = ['amount', 'method', 'reference', 'note'] as const;
export type PaymentField = (typeof PAYMENT_FIELDS)[number];

export interface TypedPayment {
  amount: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
}

/** A positive amount, canonical at scale 4 so the stored figure is the checked
 *  one. Typed as studios type it ("1,500", Arabic digits, "EGP"); empty or zero
 *  is payment_amount_invalid, unreadable not_a_number, past the cap
 *  amount_too_large (never a numeric overflow at the write). */
export function readPaymentAmount(amount: unknown): FieldRead<string> {
  return readPositiveAmount(amount, { code: 'payment_amount_invalid' });
}

/**
 * Every typed value, or every refusal under its field. An over-long text is a
 * REFUSAL, not a truncation: a payment reference cut at 200 characters is a
 * reference that reconciles against nothing.
 */
export function readPaymentFields(input: TypedPayment) {
  return readFields({
    amount: readPaymentAmount(input.amount),
    method: readOptionalText(input.method, MAX_LABEL_CHARS),
    reference: readOptionalText(input.reference, MAX_LABEL_CHARS),
    note: readOptionalText(input.note, MAX_NOTE_CHARS),
  });
}

/** The form's pre-check: the same rules, as the refusals under each field. */
export function paymentFieldErrors(input: TypedPayment): FieldErrors<PaymentField> {
  const read = readPaymentFields(input);
  return read.ok ? {} : read.errors;
}
