// What the client page shows about the studio (Round C, C8): its phone and
// WhatsApp, and how to pay it. PURE and CLIENT-SAFE: no db, no server-only.
//
// THE RULES ARE 0058's CHECKS AND STRICTER, applied before the write, so a value
// this accepts never trips one of them and always reads and dials right on the
// client page: a studio owner pasting a bank name out of a banking app (which
// carries invisible bidi marks next to Arabic) gets it saved clean, not a
// database error.
//
// A SAVE IS A SET OF CHANGES (fix round F1): a field the caller did not send is
// left as stored; clearing one is an explicit null (or a blank string). So a
// Settings sheet opened before a colleague's save can never quietly put the
// colleague's fields back.
import { hasFieldErrors, type FieldError, type FieldErrors } from '@/lib/actions/field-errors';
import { toLatinNumerals } from '@/lib/money/separators';
import { ibanChecksumHolds } from '@/lib/validation/iban';
import { countCharacters } from '@/lib/validation/text';
import { strippedText, unprintableReason } from './printable-text';
import { reachableOnWhatsapp, studioPhoneOf } from './studio-phone';

export const CLIENT_PAGE_FIELDS = [
  'studioPhone',
  'studioWhatsapp',
  'instapayAddress',
  'bankName',
  'bankAccountHolder',
  'bankAccountNumber',
  'bankIban',
] as const;

export type ClientPageField = (typeof CLIENT_PAGE_FIELDS)[number];
export type ClientPageDetails = Record<ClientPageField, string | null>;

/** What a save asks for: the changes, every field refusal at once, or input no
 *  form can send (not an object, an unknown key, a value that is not text). */
export type ClientPageChanges =
  | { ok: true; value: Partial<ClientPageDetails> }
  | { ok: false; errors: FieldErrors<ClientPageField> }
  | { ok: false; malformed: true };

/** Longer than any field can be once spaces are gone: refused before any work. */
const MAX_RAW_CHARS = 300;

const ACCOUNT_NUMBER = /^[0-9A-Za-z-]{4,34}$/;
const IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/;

/** Inclusive code-point bounds of the free-text fields (0058). */
const TEXT_BOUNDS: Partial<Record<ClientPageField, readonly [number, number]>> = {
  instapayAddress: [3, 100],
  bankName: [2, 120],
  bankAccountHolder: [2, 120],
};

type FieldResult = { value: string } | { error: FieldError };

function textBounded(field: ClientPageField, text: string): FieldResult {
  const [min, max] = TEXT_BOUNDS[field] ?? [1, 0];
  const length = countCharacters(text);
  if (length < min) return { error: { code: 'too_short', params: { min } } };
  return length > max ? { error: { code: 'too_long', params: { max } } } : { value: text };
}

function normalizeField(field: ClientPageField, text: string): FieldResult {
  switch (field) {
    case 'studioPhone':
    case 'studioWhatsapp': {
      const phone = studioPhoneOf(text);
      if (!phone) return { error: { code: 'phone_invalid' } };
      // The client page opens wa.me with it: a number WhatsApp cannot place
      // (a landline) would never show a button.
      return field === 'studioWhatsapp' && !reachableOnWhatsapp(phone)
        ? { error: { code: 'whatsapp_invalid' } }
        : { value: phone };
    }
    case 'bankAccountNumber': {
      const account = toLatinNumerals(text).replace(/\s/g, '');
      return ACCOUNT_NUMBER.test(account) && /[0-9]/.test(account)
        ? { value: account }
        : { error: { code: 'account_number_invalid' } };
    }
    case 'bankIban': {
      const iban = toLatinNumerals(text).replace(/\s/g, '').toUpperCase();
      return IBAN.test(iban) && ibanChecksumHolds(iban) ? { value: iban } : { error: { code: 'iban_invalid' } };
    }
    default:
      return textBounded(field, text);
  }
}

/** One sent text: blank clears it; anything else is checked by its field's rule. */
function normalizeText(field: ClientPageField, raw: string): { value: string | null } | { error: FieldError } {
  // Past any field's length: said with the field's own rule, before any work.
  if (raw.length > MAX_RAW_CHARS) return normalizeField(field, raw.slice(0, MAX_RAW_CHARS + 1));
  const text = strippedText(raw);
  if (text === '') return { value: null };
  if (unprintableReason(text) !== null) return { error: { code: 'unprintable' } };
  return normalizeField(field, text);
}

/**
 * The changes a save asks for, each normalised. `input` must be a plain object
 * whose keys are client-page fields and whose values are text or null; a key
 * that is absent is unchanged. Every refused field is named at once.
 */
export function normalizeClientPageChanges(input: unknown): ClientPageChanges {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, malformed: true };
  const sent = input as Record<string, unknown>;
  if (Object.keys(sent).some((key) => !(CLIENT_PAGE_FIELDS as readonly string[]).includes(key))) {
    return { ok: false, malformed: true };
  }
  const value: Partial<ClientPageDetails> = {};
  const errors: Partial<Record<ClientPageField, FieldError>> = {};
  for (const field of CLIENT_PAGE_FIELDS) {
    if (!Object.hasOwn(sent, field)) continue;
    const raw = sent[field];
    if (raw === null) {
      value[field] = null;
      continue;
    }
    if (typeof raw !== 'string') return { ok: false, malformed: true };
    const result = normalizeText(field, raw);
    if ('error' in result) errors[field] = result.error;
    else value[field] = result.value;
  }
  return hasFieldErrors(errors) ? { ok: false, errors } : { ok: true, value };
}

/**
 * The details a save leaves behind: the stored ones with the changes applied,
 * or the refusal of the one rule that spans fields: an account number or IBAN
 * needs a bank name, said on the bank name, the field the studio has to fill.
 */
export function detailsAfter(
  stored: ClientPageDetails,
  changes: Partial<ClientPageDetails>,
): { ok: true; value: ClientPageDetails } | { ok: false; errors: FieldErrors<ClientPageField> } {
  const value = { ...stored, ...changes };
  if ((value.bankAccountNumber !== null || value.bankIban !== null) && value.bankName === null) {
    return { ok: false, errors: { bankName: { code: 'bank_name_required' } } };
  }
  return { ok: true, value };
}

/** Done for the setup checklist: a way to reach the studio AND a way to pay it. */
export function hasClientPageDetails(details: Partial<ClientPageDetails>): boolean {
  const reachable = Boolean(details.studioPhone) || Boolean(details.studioWhatsapp);
  const payable = Boolean(details.instapayAddress) || Boolean(details.bankAccountNumber) || Boolean(details.bankIban);
  return reachable && payable;
}
