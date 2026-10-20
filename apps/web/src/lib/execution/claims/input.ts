// What the studio types when it confirms a client's "I paid": the amount that
// arrived. PURE and CLIENT-SAFE: the confirm dialog checks it on Save, the core
// again on arrival. Read the way studios type money ("1,500", Arabic digits),
// stored at scale 4, a fifth decimal refused rather than cut, as the payment
// form reads it (../payments/input.ts).
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readPositiveExactAmount } from '@/lib/validation/amount-field';

export const CONFIRM_CLAIM_FIELDS = ['amount'] as const;
export type ConfirmClaimField = (typeof CONFIRM_CLAIM_FIELDS)[number];

/** The amount as stored, or the refusal under its box. */
export function readConfirmedAmount(raw: unknown) {
  return readPositiveExactAmount(raw, { code: 'payment_amount_invalid' });
}

/** The dialog's pre-check: the same rule, as the refusal under the box. */
export function confirmClaimFieldErrors(input: { amount: unknown }): FieldErrors<ConfirmClaimField> {
  const read = readConfirmedAmount(input.amount);
  return read.ok ? {} : { amount: read.error };
}
