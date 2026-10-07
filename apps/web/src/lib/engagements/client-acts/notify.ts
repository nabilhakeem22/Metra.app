import 'server-only';
// The studio hears the client (Round B, B10): after a portal write answered
// `ok`, ONE call to app_delivery_notify_studio_by_token writes (or collapses
// into) an unread "client responded" notification for every member whose role
// can act on it, and the members who got a NEW row are emailed after the
// client's response has been sent (./schedule-emails.ts).
//
// THE CALLER CONTRACT (50-delivery-write.sql) is kept here: the body key, the
// role list and the params come from the server-side map in ./acts.ts, never
// from request input; this runs only after the write SDF returned `ok` (the
// portal action's job); and `new_recipients` and `locale` never leave the
// server: the portal learns one boolean.
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withDeadline } from '@/lib/http/deadlines';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { CLIENT_ACT_BODY_KEY, clientActParams, recipientRolesFor, type ClientAct } from './acts';
import { scheduleStudioEmails } from './schedule-emails';
import { parseStudioNotified } from './studio-notified';

/**
 * The most the client's answer waits for notification work, all of it: the
 * notifier write, the label read, the scheduling. The act itself is already
 * committed; past this the portal says "recorded" and the studio still sees
 * the delivery's state. The notifier is a WRITE: a call abandoned here can
 * still commit, so its rows may land without their email.
 */
export const NOTIFY_BUDGET_MS = 2_000;

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
  const deadlineAt = Date.now() + NOTIFY_BUDGET_MS;
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
      await scheduleStudioEmails(token, act, notified, deadlineAt);
    }
    return { studioNotified: notified.notifiedCount > 0 };
  } catch (err) {
    console.error('client act notify failed:', { act: bodyKey, error: loggableFailure(err) });
    return { studioNotified: false };
  }
}

/**
 * A portal write's result, plus whether the studio heard about it. The notifier
 * runs ONLY on a first `ok`: a refusal and an idempotent repeat (`already`)
 * never reach it, so a client tapping twice notifies once. `act` is null when
 * the write's input names no act (it then answered a refusal anyway).
 */
export async function withStudioNotified<TResult extends { ok: boolean; code?: 'already' }>(
  rawToken: string,
  result: TResult,
  act: ClientAct | null,
): Promise<TResult & { studioNotified: boolean }> {
  if (!result.ok || result.code === 'already' || act === null) {
    return { ...result, studioNotified: false };
  }
  const { studioNotified } = await notifyStudioOfClientAct(rawToken, act);
  return { ...result, studioNotified };
}
