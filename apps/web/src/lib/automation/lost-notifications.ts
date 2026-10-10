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
// CHEAP WHEN IDLE (fix round F5): the probe (./lost-act-probe.ts) answers on
// the handover closer's transaction; with nothing to repair this core opens no
// transaction at all. With something to repair: ONE CLAIM PER CAIRO HOUR, taken
// in the same transaction as the sweep and kept only when the function accepted
// this actor (a refusal rolls the claim back), and at most 50 notifier calls per
// org per hour, the rest wait.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext } from '@/lib/db/context';
import { sendClientActEmail } from '@/lib/email/delivery-senders';
import { recipientRolesByBodyKey } from '@/lib/engagements/client-acts/acts';
import { emailDeliveryLabel } from '@/lib/engagements/client-acts/email-label';
import { parseLostActs, type RepairedAct } from '@/lib/engagements/client-acts/lost-acts';
import { claimPeriod } from './claim';
import { cairoHourKey } from './clock';
import { emailEachRecipient } from './email-delivery';
import { lostActWindow, sharedLostActProbe } from './lost-act-probe';
import type { AutomationDeps, AutomationResult } from './types';

/** Thrown inside the transaction when the function refused the actor, so the claim rolls back. */
class SweepRefused extends Error {}

type SweepOutcome = RepairedAct[] | 'nothing' | 'claimed';

/** Probe (unless the closer already did), claim the hour, then sweep. */
async function sweep(tx: MetraDb, deps: AutomationDeps): Promise<SweepOutcome> {
  const { ctx, now } = deps;
  if (!(await sharedLostActProbe(deps, tx))) return 'nothing';
  if (!(await claimPeriod(tx, ctx.orgId, 'notify', cairoHourKey(now)))) return 'claimed';
  const { since, until } = lostActWindow(now);
  const roles = JSON.stringify(recipientRolesByBodyKey());
  const rows = (await tx.execute(sql`select public.app_notify_lost_client_acts(
      ${since}::timestamptz, ${until}::timestamptz, ${roles}::jsonb
    ) as data`)) as unknown as Array<{ data: unknown }>;
  const repaired = parseLostActs(rows[0]?.data ?? null);
  if (repaired === null) throw new SweepRefused();
  return repaired;
}

/** Whether the closer's probe already said this org has nothing to repair (no transaction needed). */
async function knownIdle(deps: AutomationDeps): Promise<boolean> {
  const probe = deps.memo.lostActsPossible;
  return probe !== undefined && (await probe.catch(() => true)) === false;
}

export async function runLostNotificationSweep(deps: AutomationDeps): Promise<AutomationResult> {
  const result: AutomationResult = { automation: 'notify', ran: false, effects: 0, emailsSent: 0, emailsFailed: 0 };
  if (await knownIdle(deps)) return result;
  let outcome: SweepOutcome;
  try {
    outcome = await withOrgContext(deps.ctx, (tx) => sweep(tx, deps));
  } catch (err) {
    if (!(err instanceof SweepRefused)) throw err;
    // The function's gate refused this actor or window: nothing was swept or claimed.
    console.warn('lost notification sweep refused', { org: deps.ctx.orgId });
    return result;
  }
  if (outcome === 'nothing' || outcome === 'claimed') return result;
  result.ran = true;
  for (const { act, notified } of outcome) {
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
