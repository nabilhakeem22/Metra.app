// What the studio types when it records an approval the client gave off the
// platform: how (required), the day (within the round under review), a note.
// Pure and client-safe: the form checks it on Save, and the transition's
// payload parser (offline-approval.ts) again on arrival.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readFields, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';
import { MAX_LABEL_CHARS, MAX_NOTE_CHARS } from '@/lib/validation/text';
import { isCalendarDay } from './event-provenance';
import type { OfflineApprovalBounds } from './review-round';

export const OFFLINE_APPROVAL_FIELDS = ['channel', 'occurredOn', 'note'] as const;
export type OfflineApprovalField = (typeof OFFLINE_APPROVAL_FIELDS)[number];

export interface TypedOfflineApproval {
  channel?: unknown;
  occurredOn?: string | null;
  note?: string | null;
}

/** HOW the client approved is the one thing this record cannot be without. */
function readChannelChosen(channel: unknown): FieldRead<unknown> {
  return channel === undefined || channel === null || channel === ''
    ? { ok: false, error: { code: 'required' } }
    : { ok: true, value: channel };
}

/** Optional; a real calendar day inside the round under review, by Cairo day. */
function readApprovalDay(value: string | null | undefined, bounds: OfflineApprovalBounds): FieldRead<string | null> {
  const read = readOptionalText(value, MAX_LABEL_CHARS);
  if (!read.ok || read.value === null) return read;
  if (!isCalendarDay(read.value)) return { ok: false, error: { code: 'invalid_date' } };
  if (read.value < bounds.earliest || read.value > bounds.latest) {
    return { ok: false, error: { code: 'offline_approval_date_out_of_range' } };
  }
  return read;
}

export function readOfflineApprovalFields(input: TypedOfflineApproval, bounds: OfflineApprovalBounds) {
  return readFields({
    channel: readChannelChosen(input.channel),
    occurredOn: readApprovalDay(input.occurredOn, bounds),
    note: readOptionalText(input.note, MAX_NOTE_CHARS),
  });
}

/** The form's pre-check: the same rules, as the refusals under each field. */
export function offlineApprovalFieldErrors(
  input: TypedOfflineApproval,
  bounds: OfflineApprovalBounds,
): FieldErrors<OfflineApprovalField> {
  const read = readOfflineApprovalFields(input, bounds);
  return read.ok ? {} : read.errors;
}
