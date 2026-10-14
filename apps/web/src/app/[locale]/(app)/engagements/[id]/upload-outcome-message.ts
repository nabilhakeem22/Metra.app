// What the upload queue says next to a file that did not land. PURE: the hook
// passes its two translators.
import { describeFailure, describeRejection, type Translate } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import type { DeliverableUploadOutcome } from './upload-deliverable';

/**
 * `t` is `engagements.files`, `te` is `errors`. A refusal says its cause (an
 * unknown failure with its reference); a request that never answered says Metra
 * could not be reached, or hands over the server's digest.
 */
export function uploadOutcomeMessage(outcome: DeliverableUploadOutcome, t: Translate, te: Translate): string | null {
  if (outcome.ok) return null;
  if (outcome.reason === 'too_large') return t('tooLarge');
  if (outcome.reason === 'wrong_type') return t('wrongType');
  if (outcome.reason === 'put_failed') return te('storage_unavailable');
  if (outcome.reason === 'rejected') return describeRejection(outcome.rejection, te);
  return describeFailure({ error: outcome.reason as ActionCode, reference: outcome.reference }, te);
}
