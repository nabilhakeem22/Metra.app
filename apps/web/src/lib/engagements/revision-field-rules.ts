// The change-order amount a revision past its free allowance must carry. Pure
// and client-safe: the revision form checks it when it asks for one, and the
// revision side effect again inside the transition.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readPositiveAmount } from '@/lib/validation/amount-field';
import type { FieldRead } from '@/lib/validation/field-rules';

export const REVISION_FIELDS = ['changeOrderAmount'] as const;
export type RevisionField = (typeof REVISION_FIELDS)[number];

/** An amount above zero, typed the way the other money boxes accept it,
 *  canonical at scale 4; unreadable or too large says so (F2, F6). */
export function readChangeOrderAmount(value: unknown): FieldRead<string> {
  return readPositiveAmount(value, { code: 'revision_co_amount_required' });
}

/** The form's pre-check, only when this revision raises a change order. */
export function revisionFieldErrors(
  typed: { changeOrderAmount: string },
  amountRequired: boolean,
): FieldErrors<RevisionField> {
  if (!amountRequired) return {};
  const read = readChangeOrderAmount(typed.changeOrderAmount.trim());
  return read.ok ? {} : { changeOrderAmount: read.error };
}
