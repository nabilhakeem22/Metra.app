import 'server-only';
// The studio's own security emails about its organisation (Round C): today, the
// alert that the contact or payment details the client page shows were changed.
// Builds the template and hands it to the ONE deadlined dispatch; best-effort,
// never throws.
import { dispatchEmail, type EmailDispatchResult } from './dispatch';
import {
  clientPageDetailsChangedEmailTemplate,
  type ClientPageDetailsChangedEmailInput,
} from './templates/client-page-details-changed';

/** To ONE owner or admin: someone changed what the studio's clients see. */
export function sendClientPageDetailsChangedEmail(
  input: ClientPageDetailsChangedEmailInput & { to: string },
): Promise<EmailDispatchResult> {
  return dispatchEmail(
    { to: input.to, ...clientPageDetailsChangedEmailTemplate(input) },
    'sendClientPageDetailsChangedEmail',
  );
}
