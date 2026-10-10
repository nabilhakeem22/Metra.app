import 'server-only';
// The studio's own security emails about its organisation (Round C): today, the
// alert that the payment details the client page shows were changed. Builds the
// template and hands it to the ONE deadlined dispatch; best-effort, never throws.
import { dispatchEmail, type EmailDispatchResult } from './dispatch';
import {
  paymentDetailsChangedEmailTemplate,
  type PaymentDetailsChangedEmailInput,
} from './templates/payment-details-changed';

/** To ONE owner or admin: someone changed the studio's payment details. */
export function sendPaymentDetailsChangedEmail(
  input: PaymentDetailsChangedEmailInput & { to: string },
): Promise<EmailDispatchResult> {
  return dispatchEmail(
    { to: input.to, ...paymentDetailsChangedEmailTemplate(input) },
    'sendPaymentDetailsChangedEmail',
  );
}
