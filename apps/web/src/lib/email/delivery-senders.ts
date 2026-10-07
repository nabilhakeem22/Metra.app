import 'server-only';
// The delivery's two emails: the studio hearing that the client acted (Round B,
// B10) and the client being reminded of their link (B11). Each builds its
// template and hands it to the ONE deadlined dispatch; best-effort, never throws.
import { dispatchEmail } from './dispatch';
import { clientActEmailTemplate, type ClientActEmailInput } from './templates/client-act';

/** To ONE studio member: the client acted on a delivery. */
export function sendClientActEmail(
  input: ClientActEmailInput & { to: string },
): Promise<{ sent: boolean }> {
  return dispatchEmail({ to: input.to, ...clientActEmailTemplate(input) }, 'sendClientActEmail');
}
