// The studio's own details on an UNTRUSTED delivery snapshot (Round C, 0058):
// its name, whether it has a logo, its phone and WhatsApp, and its payment
// instructions. PURE and client-safe; anything malformed degrades to null.
import { whatsappDigits } from '../reminder/whatsapp';
import { toLatinNumerals } from '@/lib/money/separators';
import { isUuid } from '@/lib/uuid';
import { boundedText } from './snapshot-values';
import type { PortalPaymentDetails } from './timeline-types';
import type { PublicDelivery } from './types';

/** The 0058 CHECK on studio_phone / studio_whatsapp: digits, one optional leading +. */
const STUDIO_NUMBER = /^\+?[0-9]{7,15}$/;

/** The longest value of any 0058 text column (bank name and holder: 120). */
const DETAIL_MAX_CHARS = 120;

/** The snapshot's `firm` object, as the SDF returns it. Untrusted. */
export interface FirmRow {
  name_ar?: unknown;
  name_en?: unknown;
  logo_file_id?: unknown;
  phone?: unknown;
  whatsapp?: unknown;
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** One instruction as the client reads and copies it: trimmed, Latin digits only (§4.1). */
function instructionText(value: unknown): string | null {
  const text = boundedText(value, DETAIL_MAX_CHARS);
  return text === null ? null : toLatinNumerals(text);
}

/** A studio number exactly as the CHECK allows it, or null. */
function studioNumber(value: unknown): string | null {
  return typeof value === 'string' && STUDIO_NUMBER.test(value) ? value : null;
}

/**
 * The studio as the page shows it. The logo file id is read only to say
 * whether the logo route may answer; it never reaches the browser. The
 * WhatsApp button dials the WhatsApp number, or the phone when there is none,
 * through B11's one normaliser (an Egyptian mobile without +20 is placed; a
 * number wa.me would misread is not).
 */
export function parseFirm(raw: FirmRow | null | undefined): PublicDelivery['firm'] {
  const firm = raw ?? {};
  const phone = studioNumber(firm.phone);
  const whatsapp = studioNumber(firm.whatsapp);
  return {
    nameAr: textOrNull(firm.name_ar),
    nameEn: textOrNull(firm.name_en),
    hasLogo: typeof firm.logo_file_id === 'string' && isUuid(firm.logo_file_id),
    phone,
    whatsappDigits: whatsappDigits(whatsapp ?? phone),
  };
}

/**
 * The studio's payment instructions, or null. Shown ONLY while a milestone is
 * claimable (the database applies the same rule; this is the second wall) and
 * only when the client has somewhere to pay: an InstaPay address, an account
 * number or an IBAN. A holder or a bank name alone is not an instruction.
 */
export function parsePaymentDetails(raw: unknown, claimableCount: number): PortalPaymentDetails | null {
  if (claimableCount === 0 || !raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const details: PortalPaymentDetails = {
    instapay: instructionText(row.instapay),
    bankName: instructionText(row.bank_name),
    bankAccountHolder: instructionText(row.bank_account_holder),
    bankAccountNumber: instructionText(row.bank_account_number),
    bankIban: instructionText(row.bank_iban),
  };
  const usable = details.instapay ?? details.bankAccountNumber ?? details.bankIban;
  return usable ? details : null;
}
