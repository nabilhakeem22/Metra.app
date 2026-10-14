// What a retraction needs from the studio: a reason. Pure and client-safe: the
// retract control checks it before asking to confirm, and the core again.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { clean } from '@/lib/validation/text';

export const CORRECTION_FIELDS = ['reason'] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

/** A retraction without a stated reason is just a disappearance: the whole
 *  point of correcting rather than deleting is that the record explains itself. */
export function correctionFieldErrors(input: { reason?: string | null }): FieldErrors<CorrectionField> {
  return clean(input.reason) ? {} : { reason: { code: 'required' } };
}
