// The rule a manual activity note keeps. Pure and client-safe: the note box
// runs it before sending, the core again on what arrived.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { boundedText, requiredText } from '@/lib/validation/text-field-rules';

export const ACTIVITY_FIELDS = ['note'] as const;

export type ActivityField = (typeof ACTIVITY_FIELDS)[number];

const NOTE_MAX = 4000;

/** A note must carry text, within the cap. */
export function activityNoteErrors(note: string | null | undefined): FieldErrors<ActivityField> {
  return collectFieldErrors<ActivityField>({ note: requiredText(note) ?? boundedText(note, NOTE_MAX) });
}
