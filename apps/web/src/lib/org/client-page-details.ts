// What the client page shows about the studio (Round C, C8): its phone and
// WhatsApp, and how to pay it. PURE and CLIENT-SAFE: no db, no server-only.
//
// THE RULES ARE 0058's CHECKS, applied before the write, so a value this
// accepts never trips one of them: a studio owner pasting a bank name out of a
// banking app (which carries invisible bidi marks next to Arabic) gets it saved
// clean, not a database error.
import { compactPhone, whatsappDigits } from '@/lib/engagements/reminder/whatsapp';
import { toLatinNumerals } from '@/lib/money/separators';
import { ibanChecksumHolds } from '@/lib/validation/iban';
import { countCharacters } from '@/lib/validation/text';

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

/** The payment half: a change to any of these alerts every owner and admin. */
export const PAYMENT_FIELDS: readonly ClientPageField[] = [
  'instapayAddress',
  'bankName',
  'bankAccountHolder',
  'bankAccountNumber',
  'bankIban',
];

export type ClientPageDetailsCode =
  | 'phone_invalid'
  | 'whatsapp_invalid'
  | 'iban_invalid'
  | 'bank_name_required'
  | 'invalid';

export type NormalizedClientPageDetails =
  | { ok: true; value: ClientPageDetails }
  | { ok: false; field: ClientPageField; code: ClientPageDetailsCode };

/**
 * Unicode format characters (category Cf), plus 0058's own list spelled out, so
 * a runtime with an older Unicode table still strips every one the CHECK refuses.
 */
const FORMAT_CHARACTERS =
  /[\p{Cf}\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0001}\u{E0020}-\u{E007F}]/gu;

/** Longer than any field can be once spaces are gone: refused before any work. */
const MAX_RAW_CHARS = 300;

const PHONE = /^\+?[0-9]{7,15}$/;
const ACCOUNT_NUMBER = /^[0-9A-Za-z-]{4,34}$/;
const IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/;

/** Inclusive code-point bounds of the free-text fields (0058). */
const TEXT_BOUNDS: Partial<Record<ClientPageField, readonly [number, number]>> = {
  instapayAddress: [3, 100],
  bankName: [2, 120],
  bankAccountHolder: [2, 120],
};

type FieldResult = { value: string | null } | { code: ClientPageDetailsCode };

/** A number as 0058 stores it: digits, an optional leading +; `00` becomes `+`. */
function phoneOf(text: string): string | null {
  const compact = compactPhone(text);
  const international = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  return PHONE.test(international) ? international : null;
}

function normalizeField(field: ClientPageField, text: string): FieldResult {
  switch (field) {
    case 'studioPhone': {
      const phone = phoneOf(text);
      return phone ? { value: phone } : { code: 'phone_invalid' };
    }
    case 'studioWhatsapp': {
      const phone = phoneOf(text);
      if (!phone) return { code: 'phone_invalid' };
      // The client page opens wa.me with it: a number WhatsApp cannot place
      // (a landline written nationally) would never show a button.
      return whatsappDigits(phone) ? { value: phone } : { code: 'whatsapp_invalid' };
    }
    case 'bankAccountNumber': {
      const account = toLatinNumerals(text).replace(/\s/g, '');
      return ACCOUNT_NUMBER.test(account) && /[0-9]/.test(account)
        ? { value: account }
        : { code: 'invalid' };
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

/**
 * Every field trimmed, its format characters stripped, and blank read as null;
 * then each checked by its own rule, in the card's order. The first refusal
 * names its field. An account number or IBAN without a bank name is refused on
 * the bank name, the field the studio has to fill. Anything that is not a
 * string, null or undefined is `invalid`.
 */
export function normalizeClientPageDetails(
  input: Record<ClientPageField, unknown>,
): NormalizedClientPageDetails {
  const value = {} as ClientPageDetails;
  for (const field of CLIENT_PAGE_FIELDS) {
    const raw = input[field];
    if (raw === null || raw === undefined) {
      value[field] = null;
      continue;
    }
    if (typeof raw !== 'string' || raw.length > MAX_RAW_CHARS) return { ok: false, field, code: 'invalid' };
    const text = raw.replace(FORMAT_CHARACTERS, '').trim();
    if (text === '') {
      value[field] = null;
      continue;
    }
    const result = normalizeField(field, text);
    if ('code' in result) return { ok: false, field, code: result.code };
    value[field] = result.value;
  }
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
