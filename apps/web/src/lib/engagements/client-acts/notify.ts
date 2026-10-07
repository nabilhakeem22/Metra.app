import 'server-only';
// The studio hears the client (Round B, B10): after a portal write answered
// `ok`, ONE call to app_delivery_notify_studio_by_token writes (or collapses
// into) an unread "client responded" notification for every member whose role
// can act on it, and the members who got a NEW row are emailed after the
// client's response has been sent.
//
// THE CALLER CONTRACT (50-delivery-write.sql) is kept here: the body key, the
// role list and the params come from the server-side map in ./acts.ts, never
// from request input; this runs only after the write SDF returned `ok` (the
// portal action's job); and `new_recipients` and `locale` never leave this
// module: the portal learns one boolean.
import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import { LOCALES, type Locale } from '@/i18n/routing';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { CLIENT_ACT_BODY_KEY, clientActParams, recipientRolesFor, type ClientAct } from './acts';
import { deliveryLabelForEmail } from './delivery-label';
import { emailClientActRecipients } from './email';

/** What the notifier answered, narrowed. Module-private: it never reaches the portal. */
interface StudioNotified {
  engagementId: string;
  locale: Locale;
  notifiedCount: number;
  newRecipients: string[];
}

/** The SDF's jsonb, or null when it is absent or not the documented shape. */
export function parseStudioNotified(data: unknown): StudioNotified | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (typeof row.engagement_id !== 'string' || !isUuid(row.engagement_id)) return null;
  if (typeof row.notified_count !== 'number' || !Number.isInteger(row.notified_count)) return null;
  if (!Array.isArray(row.new_recipients)) return null;
  const newRecipients = row.new_recipients.filter(
    (id): id is string => typeof id === 'string' && isUuid(id),
  );
  const locale = LOCALES.find((candidate) => candidate === row.locale) ?? 'ar-EG';
  return {
    engagementId: row.engagement_id,
    locale,
    notifiedCount: row.notified_count,
    newRecipients,
  };
}

/**
 * Tell the studio the client just acted. `studioNotified` is true only when at
 * least one notification row was written or bumped, which is the only time the
 * portal may say "your designer has been notified". Never throws: any failure
 * is one redacted log line and `studioNotified: false`. The raw token is hashed
 * here and never logged.
 */
export async function notifyStudioOfClientAct(
  rawToken: string,
  act: ClientAct,
): Promise<{ studioNotified: boolean }> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { studioNotified: false };
  try {
    const hash = hashShareToken(token);
    const bodyKey = CLIENT_ACT_BODY_KEY[act.kind];
    const params = JSON.stringify(clientActParams(act));
    const roles = JSON.stringify(recipientRolesFor(act));
    const data = await readSdfJson<unknown>(sql`select public.app_delivery_notify_studio_by_token(
      ${hash}, ${bodyKey}, ${params}::jsonb, ${roles}::jsonb
    ) as data`);
    const notified = parseStudioNotified(data);
    if (!notified) return { studioNotified: false };
    if (notified.newRecipients.length > 0) await scheduleStudioEmails(token, act, notified);
    return { studioNotified: notified.notifiedCount > 0 };
  } catch (err) {
    console.error('client act notify failed:', loggableFailure(err));
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

/**
 * Start the emails NOW and hand the promise to `after()`, so the response does
 * not wait for them and the platform keeps the isolate alive until they settle.
 * Every database read happens BEFORE `after()`: the request connection is torn
 * down there (lib/db/request-connection.ts). Never throws.
 */
async function scheduleStudioEmails(
  token: string,
  act: ClientAct,
  notified: StudioNotified,
): Promise<void> {
  try {
    const origin = await resolveRequestOrigin();
    if (!origin) {
      console.error('client act email skipped: no app origin');
      return;
    }
    const deliveryLabel = await deliveryLabelForEmail(token, notified.locale);
    const emails = emailClientActRecipients({
      userIds: notified.newRecipients,
      act,
      deliveryLabel,
      deliveryUrl: `${origin}/${notified.locale}/engagements/${notified.engagementId}`,
      locale: notified.locale,
    });
    after(() => emails);
  } catch (err) {
    console.error('client act email not scheduled:', loggableFailure(err));
  }
}
