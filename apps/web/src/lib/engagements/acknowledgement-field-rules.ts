// What the studio types when it records an acknowledgement the client gave
// off the platform (the cost range, the handover): the day it happened, what
// it was evidenced by, and a note. Pure and client-safe: the two panels run it
// on Save and the two cores run it again on arrival.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readFields, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';
import { MAX_LABEL_CHARS, MAX_NOTE_CHARS } from '@/lib/validation/text';
import { isCalendarDay } from './event-provenance';

export const ACKNOWLEDGEMENT_FIELDS = ['occurredOn', 'evidence', 'note'] as const;
export type AcknowledgementField = (typeof ACKNOWLEDGEMENT_FIELDS)[number];

export interface TypedAcknowledgement {
  occurredOn?: string | null;
  evidence?: string | null;
  note?: string | null;
}

/**
 * Optional; a real calendar day no later than `todayIso`. A future date on an
 * evidentiary record is a typo or a fabrication (event-provenance.ts). Days are
 * compared in UTC, the day the date input offers and the server checks.
 */
function readOccurredOn(value: string | null | undefined, todayIso: string): FieldRead<string | null> {
  const read = readOptionalText(value, MAX_LABEL_CHARS);
  if (!read.ok || read.value === null) return read;
  if (!isCalendarDay(read.value)) return { ok: false, error: { code: 'invalid_date' } };
  if (read.value > todayIso) return { ok: false, error: { code: 'date_in_future' } };
  return read;
}

/**
 * Every typed value, or every refusal under its field. An over-long note is a
 * REFUSAL, not a truncation: storing the first 2000 characters of an
 * evidentiary note would lose the rest without telling anyone.
 */
export function readAcknowledgementFields(input: TypedAcknowledgement, todayIso: string) {
  return readFields({
    occurredOn: readOccurredOn(input.occurredOn, todayIso),
    evidence: readOptionalText(input.evidence, MAX_NOTE_CHARS),
    note: readOptionalText(input.note, MAX_NOTE_CHARS),
  });
}

/** The panels' pre-check: the same rules, as the refusals under each field. */
export function acknowledgementFieldErrors(
  input: TypedAcknowledgement,
  todayIso: string,
): FieldErrors<AcknowledgementField> {
  const read = readAcknowledgementFields(input, todayIso);
  return read.ok ? {} : read.errors;
}
