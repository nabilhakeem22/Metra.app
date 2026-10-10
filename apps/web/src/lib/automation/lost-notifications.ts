import 'server-only';
// The hourly repair of studio notifications lost on a client's first tap (Round
// C, C11). A client act and its notification are two transactions; when the
// second one fails and the client never taps again, the studio is never told.
// The acts are the outbox: app_notify_lost_client_acts finds the ones in the
// window that no notification answers and notifies them through THE notifier,
// inside this org's RLS transaction as its owner/admin system actor (no
// BYPASSRLS). Then the members with a NEW row get the same email a first tap
// sends, through the tick's lookup and email breaker. Never a client message.
//
// ONE CLAIM PER CAIRO HOUR, so two overlapping ticks never sweep twice; the
// function makes at most 50 notifier calls per org per hour, the rest wait.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext } from '@/lib/db/context';
import { sendClientActEmail } from '@/lib/email/delivery-senders';
import { recipientRolesByBodyKey } from '@/lib/engagements/client-acts/acts';
import { emailDeliveryLabel } from '@/lib/engagements/client-acts/email-label';
import { parseLostActs, type RepairedAct } from '@/lib/engagements/client-acts/lost-acts';
import { claimPeriod } from './claim';
import { cairoHour, todayInCairo } from './clock';
import { emailEachRecipient } from './email-delivery';
import type { AutomationDeps, AutomationResult } from './types';

/** Acts older than this are not dug up. */
export const LOST_ACT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** Acts younger than this are left to the portal's own notify (never raced). */
export const LOST_ACT_SETTLE_MS = 10 * 60 * 1000;

/** The hour's claim key: `YYYY-MM-DDTHH`, Cairo. */
export function sweepPeriodKey(now: Date): string {
  return `${todayInCairo(now)}T${String(cairoHour(now)).padStart(2, '0')}`;
}

/** Claim the hour, then sweep. 'claimed': another run has this hour. */
async function sweep(tx: MetraDb, deps: AutomationDeps): Promise<RepairedAct[] | null | 'claimed'> {
  const { ctx, now } = deps;
  if (!(await claimPeriod(tx, ctx.orgId, 'notify', sweepPeriodKey(now)))) return 'claimed';
  const since = new Date(now.getTime() - LOST_ACT_LOOKBACK_MS).toISOString();
  const until = new Date(now.getTime() - LOST_ACT_SETTLE_MS).toISOString();
  const roles = JSON.stringify(recipientRolesByBodyKey());
  const rows = (await tx.execute(sql`select public.app_notify_lost_client_acts(
      ${since}::timestamptz, ${until}::timestamptz, ${roles}::jsonb
    ) as data`)) as unknown as Array<{ data: unknown }>;
  return parseLostActs(rows[0]?.data ?? null);
}

export async function runLostNotificationSweep(deps: AutomationDeps): Promise<AutomationResult> {
  const result: AutomationResult = { automation: 'notify', ran: false, effects: 0, emailsSent: 0, emailsFailed: 0 };
  const repaired = await withOrgContext(deps.ctx, (tx) => sweep(tx, deps));
  if (repaired === 'claimed') return result;
  if (repaired === null) {
    // The function's gate refused this actor or window: nothing was swept.
    console.warn('lost notification sweep refused', { org: deps.ctx.orgId });
    return result;
  }
  result.ran = true;
  for (const { act, notified } of repaired) {
    if (notified.notifiedCount > 0) result.effects += 1;
    if (notified.newRecipients.length === 0) continue;
    await emailEachRecipient(
      deps,
      notified.newRecipients,
      (to) =>
        sendClientActEmail({
          to,
          act,
          deliveryLabel: emailDeliveryLabel(notified.delivery, notified.locale),
          deliveryUrl: `${deps.appUrl}/${notified.locale}/engagements/${notified.engagementId}`,
          locale: notified.locale,
        }),
      result,
    );
  }
  return result;
}
