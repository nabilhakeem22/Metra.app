// What the studio types when it sends or voids a payment request (مطالبة دفع).
// PURE and CLIENT-SAFE: the dialog checks it on Save, the core again on arrival.
//
// Sending: an optional due date (today in Cairo or later, so the database's
// `due_on >= issued_on` never refuses it) and an optional note (500 characters,
// the column's cap). Voiding: a required reason, which goes to the audit log and
// never to the frozen request row.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readOptionalDayFromToday } from '@/lib/validation/day-field';
import { readFields, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';
import { hasVisibleCharacter } from '@/lib/validation/text';

export const REQUEST_TERM_FIELDS = ['dueOn', 'note'] as const;
export type RequestTermField = (typeof REQUEST_TERM_FIELDS)[number];

export const VOID_REQUEST_FIELDS = ['reason'] as const;
export type VoidRequestField = (typeof VOID_REQUEST_FIELDS)[number];

/** A request's note: `payment_requests_note_length`. */
export const MAX_REQUEST_NOTE_CHARS = 500;
/** A void reason: the same cap, so it reads as one paragraph in the audit trail. */
export const MAX_VOID_REASON_CHARS = 500;

export interface TypedRequestTerms {
  dueOn?: unknown;
  note?: unknown;
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `todayInCairo` is `YYYY-MM-DD`: the request is issued on that day. */
export function readRequestTerms(input: TypedRequestTerms, todayInCairo: string) {
  return readFields({
    dueOn: readOptionalDayFromToday(input.dueOn, todayInCairo),
    note: readOptionalText(asText(input.note), MAX_REQUEST_NOTE_CHARS),
  });
}

/** The send dialog's pre-check: the same rules, as the refusals under each box. */
export function requestTermsFieldErrors(
  input: TypedRequestTerms,
  todayInCairo: string,
): FieldErrors<RequestTermField> {
  const read = readRequestTerms(input, todayInCairo);
  return read.ok ? {} : read.errors;
}

/** A reason with something to read in it: blank, or only invisible marks, is missing. */
function readReason(raw: unknown): FieldRead<string> {
  const read = readOptionalText(asText(raw), MAX_VOID_REASON_CHARS);
  if (!read.ok) return read;
  if (read.value === null || !hasVisibleCharacter(read.value)) return { ok: false, error: { code: 'required' } };
  return { ok: true, value: read.value };
}

export function readVoidReason(input: { reason?: unknown }) {
  return readFields({ reason: readReason(input.reason) });
}

/** The void dialog's pre-check. */
export function voidReasonFieldErrors(input: { reason?: unknown }): FieldErrors<VoidRequestField> {
  const read = readVoidReason(input);
  return read.ok ? {} : read.errors;
}
