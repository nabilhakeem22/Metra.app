// The change-order amount a revision past its free allowance must carry. Pure
// and client-safe: the revision form checks it when it asks for one, and the
// revision side effect again inside the transition.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { formatMoney4, isMoneyString, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FieldRead } from '@/lib/validation/field-rules';

export const REVISION_FIELDS = ['changeOrderAmount'] as const;
export type RevisionField = (typeof REVISION_FIELDS)[number];

/** A well-formed amount above zero, canonical at scale 4. */
export function readChangeOrderAmount(value: unknown): FieldRead<string> {
  const refused = { ok: false, error: { code: 'revision_co_amount_required' } } as const;
  if (!isMoneyString(value)) return refused;
  const amount4 = parseMoney4(value);
  return amount4 > 0n ? { ok: true, value: formatMoney4(amount4) } : refused;
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
