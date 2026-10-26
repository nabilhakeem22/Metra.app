import 'server-only';
// The client's one-time code email: the template built and handed to the ONE
// deadlined dispatch (./dispatch.ts), which never throws. Unlike every other
// email here this one is NOT best-effort for its caller: a code that was not
// sent is an act the client cannot take, so the caller says `send_failed`.
import { dispatchEmail, type EmailDispatchResult } from './dispatch';
import { clientCodeEmailTemplate, type ClientCodeEmailInput } from './templates/client-code';

/** To the CLIENT's address on file: the code they asked for. */
export function sendClientCodeEmail(input: ClientCodeEmailInput & { to: string }): Promise<EmailDispatchResult> {
  return dispatchEmail({ to: input.to, ...clientCodeEmailTemplate(input) }, 'sendClientCodeEmail');
}
