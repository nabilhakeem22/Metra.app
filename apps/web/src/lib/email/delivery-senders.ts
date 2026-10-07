import 'server-only';
// The delivery's two emails: the studio hearing that the client acted (Round B,
// B10) and the client being reminded of their link (B11). Each builds its
// template and hands it to the ONE deadlined dispatch; best-effort, never throws.
import { dispatchEmail } from './dispatch';
import { clientActEmailTemplate, type ClientActEmailInput } from './templates/client-act';
import {
  deliveryReminderEmailTemplate,
  type DeliveryReminderEmailInput,
} from './templates/delivery-reminder';

/** To ONE studio member: the client acted on a delivery. */
export function sendClientActEmail(
  input: ClientActEmailInput & { to: string },
): Promise<{ sent: boolean }> {
  return dispatchEmail({ to: input.to, ...clientActEmailTemplate(input) }, 'sendClientActEmail');
}

/** To the CLIENT: a reminder carrying the link they already hold. */
export function sendDeliveryReminderEmail(
  input: DeliveryReminderEmailInput & { to: string },
): Promise<{ sent: boolean }> {
  return dispatchEmail(
    { to: input.to, ...deliveryReminderEmailTemplate(input) },
    'sendDeliveryReminderEmail',
  );
}
