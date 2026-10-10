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

export type ClientPageDetailsCode =
  | 'phone_invalid'
  | 'whatsapp_invalid'
  | 'iban_invalid'
  | 'bank_name_required'
  | 'invalid';

/** A refusal; `field` is null when the input as a whole is malformed. */
export type ClientPageRefusal = { ok: false; field: ClientPageField | null; code: ClientPageDetailsCode };

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

type FieldResult = { value: string } | { code: ClientPageDetailsCode };

function normalizeField(field: ClientPageField, text: string): FieldResult {
  switch (field) {
    case 'studioPhone':
    case 'studioWhatsapp': {
      const phone = studioPhoneOf(text);
      if (!phone) return { code: 'phone_invalid' };
      // The client page opens wa.me with it: a number WhatsApp cannot place
      // (a landline) would never show a button.
      return field === 'studioWhatsapp' && !reachableOnWhatsapp(phone) ? { code: 'whatsapp_invalid' } : { value: phone };
    }
    case 'bankAccountNumber': {
      const account = toLatinNumerals(text).replace(/\s/g, '');
      return ACCOUNT_NUMBER.test(account) && /[0-9]/.test(account) ? { value: account } : { code: 'invalid' };
    }
    case 'bankIban': {
      const iban = toLatinNumerals(text).replace(/\s/g, '').toUpperCase();
      return IBAN.test(iban) && ibanChecksumHolds(iban) ? { value: iban } : { code: 'iban_invalid' };
    }
    default: {
      const [min, max] = TEXT_BOUNDS[field] ?? [1, 0];
      const length = countCharacters(text);
      return length >= min && length <= max ? { value: text } : { code: 'invalid' };
    }
  }
}

/** One sent value: null or blank clears it; anything else is checked by its field's rule. */
function normalizeValue(field: ClientPageField, raw: unknown): { value: string | null } | ClientPageRefusal {
  if (raw === null) return { value: null };
  if (typeof raw !== 'string' || raw.length > MAX_RAW_CHARS) return { ok: false, field, code: 'invalid' };
  const text = strippedText(raw);
  if (text === '') return { value: null };
  if (unprintableReason(text) !== null) return { ok: false, field, code: 'invalid' };
  const result = normalizeField(field, text);
  return 'code' in result ? { ok: false, field, code: result.code } : result;
}

/**
 * The changes a save asks for, each normalised. `input` must be a plain object
 * whose keys are client-page fields; a key that is absent is unchanged. The
 * first refusal names its field; a malformed input as a whole names none.
 */
export function normalizeClientPageChanges(
  input: unknown,
): { ok: true; value: Partial<ClientPageDetails> } | ClientPageRefusal {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, field: null, code: 'invalid' };
  }
  if (Object.keys(input).some((key) => !(CLIENT_PAGE_FIELDS as readonly string[]).includes(key))) {
    return { ok: false, field: null, code: 'invalid' };
  }
  const value: Partial<ClientPageDetails> = {};
  for (const field of CLIENT_PAGE_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    const result = normalizeValue(field, (input as Record<string, unknown>)[field]);
    if ('ok' in result) return result;
    value[field] = result.value;
  }
  return { ok: true, value };
}

/**
 * The details a save leaves behind: the stored ones with the changes applied,
 * or the refusal of the one rule that spans fields: an account number or IBAN
 * needs a bank name, said on the bank name, the field the studio has to fill.
 */
export function detailsAfter(
  stored: ClientPageDetails,
  changes: Partial<ClientPageDetails>,
): { ok: true; value: ClientPageDetails } | ClientPageRefusal {
  const value = { ...stored, ...changes };
  if ((value.bankAccountNumber !== null || value.bankIban !== null) && value.bankName === null) {
    return { ok: false, field: 'bankName', code: 'bank_name_required' };
  }
  return { ok: true, value };
}

/** Done for the setup checklist: a way to reach the studio AND a way to pay it. */
export function hasClientPageDetails(details: Partial<ClientPageDetails>): boolean {
  const reachable = Boolean(details.studioPhone) || Boolean(details.studioWhatsapp);
  const payable = Boolean(details.instapayAddress) || Boolean(details.bankAccountNumber) || Boolean(details.bankIban);
  return reachable && payable;
}
