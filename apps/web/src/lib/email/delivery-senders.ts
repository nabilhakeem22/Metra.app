import 'server-only';
// The delivery's emails: the studio hearing that the client acted (Round B,
// B10), the client being reminded of their link (B11), and the studio's morning
// follow-up on deliveries waiting on the client (Round C). Each builds its
// template and hands it to the ONE deadlined dispatch; best-effort, never throws.
import { dispatchEmail, type EmailDispatchResult } from './dispatch';
import { clientActEmailTemplate, type ClientActEmailInput } from './templates/client-act';
import {
  deliveryFollowupEmailTemplate,
  type DeliveryFollowupEmailInput,
} from './templates/delivery-followup';
import {
  deliveryReminderEmailTemplate,
  type DeliveryReminderEmailInput,
} from './templates/delivery-reminder';

/** To ONE studio member: the client acted on a delivery. */
export function sendClientActEmail(
  input: ClientActEmailInput & { to: string },
): Promise<EmailDispatchResult> {
  return dispatchEmail({ to: input.to, ...clientActEmailTemplate(input) }, 'sendClientActEmail');
}

/** To the CLIENT: a reminder carrying the link they already hold. */
export function sendDeliveryReminderEmail(
  input: DeliveryReminderEmailInput & { to: string },
): Promise<EmailDispatchResult> {
  return dispatchEmail(
    { to: input.to, ...deliveryReminderEmailTemplate(input) },
    'sendDeliveryReminderEmail',
  );
}

/** To ONE owner or admin: the deliveries that have waited on the client too long. */
export function sendDeliveryFollowupEmail(
  input: DeliveryFollowupEmailInput & { to: string },
): Promise<EmailDispatchResult> {
  return dispatchEmail(
    { to: input.to, ...deliveryFollowupEmailTemplate(input) },
    'sendDeliveryFollowupEmail',
  );
}
