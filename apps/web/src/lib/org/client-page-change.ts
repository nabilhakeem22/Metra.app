// What changed in the studio's client page details, and how that change is
// written down (Round C, owner decision Oct 10; fix round F4, S2). PURE and
// CLIENT-SAFE.
//
// A number someone can pay into or call is never written out in full anywhere
// but its own column. The audit row keeps a few trailing characters of each
// number (never most of a short one), the InstaPay domain with its local part
// masked, the names as typed, and a keyed FINGERPRINT of every masked value
// (./audit-fingerprint.ts): two different values always read differently, the
// same value always reads the same, and neither can be recovered from it. That
// is what lets the log show WHICH account a change put in, not only THAT one
// changed.
import { CLIENT_PAGE_FIELDS, type ClientPageDetails, type ClientPageField } from './client-page-details';

/** Shown in place of every masked character. */
const MASK = '••••';

/** At most this many trailing characters of a number stay visible. */
const MAX_VISIBLE_TAIL = 4;

/** Names a person reads, not numbers a person pays into or calls: kept as typed. */
const UNMASKED_FIELDS: readonly ClientPageField[] = ['bankName', 'bankAccountHolder'];

/** A keyed, irreversible tag for one value of one field; null when no key is configured. */
export type Fingerprint = (field: ClientPageField, value: string) => string | null;

/** The fields whose stored value differs, in the card's order. */
export function changedFields(before: ClientPageDetails, after: ClientPageDetails): ClientPageField[] {
  return CLIENT_PAGE_FIELDS.filter((field) => before[field] !== after[field]);
}

/**
 * `••••` and the last characters of `text`: as many as are left after hiding
 * four, and never more than four, so a five-character value shows one and a
 * value of four or fewer shows none. Code points, so nothing is cut in half.
 */
function maskedTail(text: string): string {
  const characters = [...text];
  const visible = Math.max(0, Math.min(MAX_VISIBLE_TAIL, characters.length - MAX_VISIBLE_TAIL));
  return MASK + (visible > 0 ? characters.slice(-visible).join('') : '');
}

/** An InstaPay address keeps its (shared) domain; its local part is what identifies it. */
function maskedInstapay(address: string): string {
  const at = address.lastIndexOf('@');
  return at > 0 ? `${maskedTail(address.slice(0, at))}${address.slice(at)}` : maskedTail(address);
}

/**
 * One value as the audit row keeps it: null stays null, a name stays as typed,
 * anything else is masked and, when a fingerprint key is configured, tagged
 * `#<8 hex>`.
 */
export function maskedValue(field: ClientPageField, value: string | null, fingerprint?: Fingerprint): string | null {
  if (value === null) return null;
  if (UNMASKED_FIELDS.includes(field)) return value;
  const masked = field === 'instapayAddress' ? maskedInstapay(value) : maskedTail(value);
  const tag = fingerprint?.(field, value) ?? null;
  return tag ? `${masked} #${tag}` : masked;
}

/** The audit row's `before` and `after`: the changed fields only, masked. */
export function maskedChange(
  before: ClientPageDetails,
  after: ClientPageDetails,
  fields: readonly ClientPageField[],
  fingerprint?: Fingerprint,
): { before: Partial<ClientPageDetails>; after: Partial<ClientPageDetails> } {
  const masked = (details: ClientPageDetails) =>
    Object.fromEntries(fields.map((field) => [field, maskedValue(field, details[field], fingerprint)]));
  return { before: masked(before), after: masked(after) };
}
