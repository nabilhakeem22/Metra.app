// What the studio types when it records that the client signed the contract on
// paper: the day (required, not after today in Cairo) and an optional note.
// PURE and CLIENT-SAFE: the dialog checks it on Save, the core again on arrival.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readFields, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';
import { validIsoDate } from '@/lib/validation/iso-date';
import { requiredText } from '@/lib/validation/text-field-rules';

export const SIGN_OFFLINE_FIELDS = ['signedOn', 'note'] as const;
export type SignOfflineField = (typeof SIGN_OFFLINE_FIELDS)[number];

/** The note's cap: the same 500 characters as a payment request's note. */
export const MAX_SIGN_OFFLINE_NOTE_CHARS = 500;

export interface TypedOfflineSignature {
  signedOn?: unknown;
  note?: unknown;
}

function readSignedOn(raw: unknown, todayInCairo: string): FieldRead<string> {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const missing = requiredText(value);
  if (missing) return { ok: false, error: missing };
  if (!validIsoDate(value)) return { ok: false, error: { code: 'invalid_date' } };
  if (value > todayInCairo) return { ok: false, error: { code: 'date_in_future' } };
  return { ok: true, value };
}

/** `todayInCairo` is `YYYY-MM-DD`: the Cairo day decides "today", never UTC. */
export function readOfflineSignature(input: TypedOfflineSignature, todayInCairo: string) {
  return readFields({
    signedOn: readSignedOn(input.signedOn, todayInCairo),
    note: readOptionalText(typeof input.note === 'string' ? input.note : null, MAX_SIGN_OFFLINE_NOTE_CHARS),
  });
}

/** The dialog's pre-check: the same rules, as the refusals under each box. */
export function offlineSignatureFieldErrors(
  input: TypedOfflineSignature,
  todayInCairo: string,
): FieldErrors<SignOfflineField> {
  const read = readOfflineSignature(input, todayInCairo);
  return read.ok ? {} : read.errors;
}
