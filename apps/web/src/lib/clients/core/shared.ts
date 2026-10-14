// What create and update share at the boundary: the tamper check on the type,
// and the database's own percentage range, named so a race past the pre-check
// still lands under the field.
import { CLIENT_TYPES, type ClientType } from '@metra/db';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';

export const CLIENT_PERCENT_REFUSALS: readonly ConstraintRefusal[] = [
  { constraint: 'clients_advance_pct_range', field: 'advancePct', error: { code: 'invalid_percentage' } },
  { constraint: 'clients_retention_pct_range', field: 'retentionPct', error: { code: 'invalid_percentage' } },
];

/** A type outside the select: no form can send it (`malformed`). */
export function isClientType(type: ClientType | null | undefined): boolean {
  return type === null || type === undefined || CLIENT_TYPES.includes(type);
}
