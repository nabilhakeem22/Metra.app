import 'server-only';
// Both values are read at REQUEST time (lib/cf/secrets): on Cloudflare they are
// Worker secrets rather than build-time vars, so rotating the Resend key is a
// `wrangler secret put` and not a redeploy.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { runtimeSecret } from '@/lib/cf/secrets';
import { EMAIL_TIMEOUT_MS, withDeadline } from '@/lib/http/deadlines';

/** One email, fully built: the address and the rendered content. */
export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * ONE dispatch, so there is ONE place a timeout can be missing from. Every
 * sender in lib/email goes through it.
 *
 * DEADLINED. Resend's SDK takes no AbortSignal, so the bound is on the WAIT: the
 * send is raced against a rejecting timer and a slow origin becomes
 * `{ sent: false }` instead of a server action held open until the platform
 * kills it. That matters most on the proposal path, which is awaited AFTER the
 * proposal has been sent and the share link minted — the studio must get their
 * answer whether or not Resend is having a day.
 *
 * NEVER THROWS. Every caller is best-effort by design: a missing key, a Resend
 * error and a deadline are all `{ sent: false }`, logged under the caller's own
 * label so the log still says which email it was.
 */
export async function dispatchEmail(
  payload: EmailPayload,
  label: string,
): Promise<{ sent: boolean }> {
  const apiKey = runtimeSecret('RESEND_API_KEY');
  const from = runtimeSecret('RESEND_FROM');
  if (!apiKey || !from) return { sent: false };
  try {
    // The deadline covers the SDK import too, so its timer is armed
    // synchronously — before the first await — and nothing inside the send
    // can start the clock late.
    const res = await withDeadline(
      sendViaResend(apiKey, from, payload),
      EMAIL_TIMEOUT_MS,
      label,
    );
    return { sent: !res.error };
  } catch (err) {
    console.error(`${label} failed:`, loggableFailure(err));
    return { sent: false };
  }
}

/** The SDK is loaded lazily: most requests never send an email. */
async function sendViaResend(
  apiKey: string,
  from: string,
  payload: EmailPayload,
): Promise<{ error: unknown }> {
  const { Resend } = await import('resend');
  return new Resend(apiKey).emails.send({ from, ...payload });
}
