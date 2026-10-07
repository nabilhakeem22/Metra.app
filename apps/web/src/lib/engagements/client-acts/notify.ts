import 'server-only';
// The studio hears the client (Round B, B10): after a portal write answered
// `ok`, ONE call to app_delivery_notify_studio_by_token writes (or collapses
// into) an unread "client responded" notification for every member whose role
// can act on it, and the members who got a NEW row are emailed after the
// client's response has been sent (./schedule-emails.ts).
//
// THE CALLER CONTRACT (50-delivery-write.sql) is kept here: the body key, the
// role list and the params come from the server-side map in ./acts.ts, never
// from request input; this runs after the write SDF returned `ok`, or on an
// `already` whose act was never notified (./already-notified.ts, 0057); and
// `new_recipients` and `locale` never leave the server: the portal learns one
// boolean.
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withDeadline } from '@/lib/http/deadlines';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { CLIENT_ACT_BODY_KEY, clientActParams, recipientRolesFor, type ClientAct } from './acts';
import { actAlreadyNotified } from './already-notified';
import { NOTIFY_BUDGET_MS } from './notify-budget';
import { scheduleStudioEmails } from './schedule-emails';
import { parseStudioNotified } from './studio-notified';

/**
 * Tell the studio the client just acted. `studioNotified` is true only when at
 * least one notification row was written or bumped, which is the only time the
 * portal may say "your designer has been notified". Never throws and never
 * waits past NOTIFY_BUDGET_MS: any failure is one redacted log line and
 * `studioNotified: false`. The raw token is hashed here and never logged.
 */
export async function notifyStudioOfClientAct(
  rawToken: string,
  act: ClientAct,
): Promise<{ studioNotified: boolean }> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { studioNotified: false };
  const bodyKey = CLIENT_ACT_BODY_KEY[act.kind];
  try {
    const hash = hashShareToken(token);
    const params = JSON.stringify(clientActParams(act));
    const roles = JSON.stringify(recipientRolesFor(act));
    const data = await withDeadline(
      readSdfJson<unknown>(sql`select public.app_delivery_notify_studio_by_token(
        ${hash}, ${bodyKey}, ${params}::jsonb, ${roles}::jsonb
      ) as data`),
      NOTIFY_BUDGET_MS,
      'client act notify',
    );
    const notified = parseStudioNotified(data);
    if (!notified) {
      // A dead link, or drift between acts.ts and the SQL allowlist: either
      // way nobody heard, and that must be visible (no token, no member id).
      console.warn('client act notify wrote nothing:', { act: bodyKey });
      return { studioNotified: false };
    }
    if (notified.newRecipients.length > 0) {
      await scheduleStudioEmails(act, notified);
    }
    return { studioNotified: notified.notifiedCount > 0 };
  } catch (err) {
    console.error('client act notify failed:', { act: bodyKey, error: loggableFailure(err) });
    return { studioNotified: false };
  }
}

/**
 * Whether the studio has heard about an act the write answered `already` for,
 * notifying now if it never did (R3, 0057). A comment has no single act to
 * anchor on and never repeats as `already` in practice, so it is never re-sent.
 * `true`: the notification exists, nothing is sent. `false`: it was lost, so
 * this is the first notification. `null` (no answer, or the check failed): not
 * notified, and nothing is sent.
 */
async function notifyIfNeverNotified(
  rawToken: string,
  act: ClientAct,
): Promise<{ studioNotified: boolean }> {
  if (act.kind === 'commented') return { studioNotified: false };
  const alreadyNotified = await actAlreadyNotified(rawToken, act);
  if (alreadyNotified === true) return { studioNotified: true };
  if (alreadyNotified === false) return notifyStudioOfClientAct(rawToken, act);
  return { studioNotified: false };
}

/**
 * A portal write's result, plus whether the studio heard about it. A refusal
 * never notifies. A first `ok` notifies. An idempotent repeat (`already`)
 * notifies only when the first one's notification was never written, so a
 * client tapping twice notifies once and a lost notification is repaired; it
 * then reports the truth about the act either way. `act` is null when the
 * write's input names no act (it then answered a refusal anyway).
 */
export async function withStudioNotified<TResult extends { ok: boolean; code?: 'already' }>(
  rawToken: string,
  result: TResult,
  act: ClientAct | null,
): Promise<TResult & { studioNotified: boolean }> {
  if (!result.ok || act === null) return { ...result, studioNotified: false };
  const { studioNotified } =
    result.code === 'already'
      ? await notifyIfNeverNotified(rawToken, act)
      : await notifyStudioOfClientAct(rawToken, act);
  return { ...result, studioNotified };
}
