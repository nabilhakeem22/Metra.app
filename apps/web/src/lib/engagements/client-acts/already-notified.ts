import 'server-only';
// Was THIS client act's studio notification ever written? (Round B, 0057, R3.)
// A portal write answers `already` on a repeat tap. If the notifier failed on
// the first `ok`, the studio was never told; asking here, on the repeat, lets
// the portal repair that loss without notifying twice for an act the studio
// already heard about (app_delivery_act_notified_by_token, 50-delivery-write.sql).
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withDeadline } from '@/lib/http/deadlines';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { CLIENT_ACT_BODY_KEY, type ClientAct } from './acts';
import { NOTIFY_BUDGET_MS } from './notify-budget';

/**
 * true: the act's notification exists (read or not). false: it was never
 * written. null: the predicate has no answer (a dead link, an act with no
 * anchor such as a comment, no anchor row) or the read failed or ran past
 * NOTIFY_BUDGET_MS; the caller then does not notify. Never throws; a failure
 * is one redacted log line (the act key only: no token, no ids).
 */
export async function actAlreadyNotified(rawToken: string, act: ClientAct): Promise<boolean | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const bodyKey = CLIENT_ACT_BODY_KEY[act.kind];
  try {
    const notified = await withDeadline(
      readSdfJson<unknown>(sql`select public.app_delivery_act_notified_by_token(
        ${hashShareToken(token)}, ${bodyKey}, ${act.milestoneKind ?? null}
      ) as data`),
      NOTIFY_BUDGET_MS,
      'client act notified check',
    );
    return typeof notified === 'boolean' ? notified : null;
  } catch (err) {
    console.error('client act notified check failed:', { act: bodyKey, error: loggableFailure(err) });
    return null;
  }
}
