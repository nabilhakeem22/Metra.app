// What changed in the studio's client page details, and how that change is
// written down (Round C, owner decision Oct 10). PURE and CLIENT-SAFE.
//
// A number someone can pay into is never written out in full anywhere but its
// own column: the audit row keeps the last four characters of each number and
// the names as typed, which is enough to see WHAT changed without the audit
// log becoming a second copy of the studio's bank details.
import {
  CLIENT_PAGE_FIELDS,
  PAYMENT_FIELDS,
  type ClientPageDetails,
  type ClientPageField,
} from './client-page-details';

/** Shown in place of every masked character. */
const MASK = '••••';

/** How many trailing characters of a number the audit keeps. */
const VISIBLE_TAIL = 4;

/** Names a person reads, not numbers a person pays into: kept as typed. */
const UNMASKED_FIELDS: readonly ClientPageField[] = ['bankName', 'bankAccountHolder'];

/** The fields whose stored value differs, in the card's order. */
export function changedFields(before: ClientPageDetails, after: ClientPageDetails): ClientPageField[] {
  return CLIENT_PAGE_FIELDS.filter((field) => before[field] !== after[field]);
}

/** The payment fields among `fields`: a change to any of them alerts the owners and admins. */
export function changedPaymentFields(fields: readonly ClientPageField[]): ClientPageField[] {
  return fields.filter((field) => PAYMENT_FIELDS.includes(field));
}

/**
 * One value as the audit row keeps it: null stays null, a name stays as typed,
 * a number becomes `••••` plus its last four characters (just `••••` when it is
 * four characters or fewer, so nothing short is written out whole).
 */
export function maskedValue(field: ClientPageField, value: string | null): string | null {
  if (value === null) return null;
  if (UNMASKED_FIELDS.includes(field)) return value;
  // Code points, so an astral character is never cut in half.
  const characters = [...value];
  if (characters.length <= VISIBLE_TAIL) return MASK;
  return MASK + characters.slice(-VISIBLE_TAIL).join('');
}

/** The audit row's `before` and `after`: the changed fields only, masked. */
export function maskedChange(
  before: ClientPageDetails,
  after: ClientPageDetails,
  fields: readonly ClientPageField[],
): { before: Partial<ClientPageDetails>; after: Partial<ClientPageDetails> } {
  const masked = (details: ClientPageDetails) =>
    Object.fromEntries(fields.map((field) => [field, maskedValue(field, details[field])]));
  return { before: masked(before), after: masked(after) };
}
