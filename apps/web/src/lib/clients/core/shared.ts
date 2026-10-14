// What create and update share at the boundary: the tamper check on the type,
// and the database's own percentage range, named so a race past the pre-check
// still lands under the field.
import { CLIENT_TYPES, type ClientType } from '@metra/db';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';
import { PERCENT_REFUSAL } from '@/lib/validation/number-field-rules';

export const CLIENT_PERCENT_REFUSALS: readonly ConstraintRefusal[] = [
  { constraint: 'clients_advance_pct_range', field: 'advancePct', error: PERCENT_REFUSAL },
  { constraint: 'clients_retention_pct_range', field: 'retentionPct', error: PERCENT_REFUSAL },
];

/** A type outside the select: no form can send it (`malformed`). */
export function isClientType(type: ClientType | null | undefined): boolean {
  return type === null || type === undefined || CLIENT_TYPES.includes(type);
}
