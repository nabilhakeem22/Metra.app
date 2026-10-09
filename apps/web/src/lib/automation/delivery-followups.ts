import 'server-only';
// Morning follow-ups on deliveries that wait on the client (Round C, C4). The
// studio is reminded, never the client (owner decision Q2: Metra sends no client
// message on its own): every owner and admin, the roles that may send the
// existing WhatsApp/email reminder, gets one notification per delivery and one
// email listing them. Reuses the quotation follow-up setting: "follow up when a
// client has not answered for N days" covers deliveries too.
//
// TWO STATEMENTS PER ORG, whatever the week has already done (R1, R3): the
// in-flight read is shared with the digest; the day's claim, this week's earlier
// reminders and the recipients are one statement, and the day's picks are claimed
// and notified in another (delivery-followup-writes.ts), so the day claim is held
// briefly and an overlapping run waits only that long.
//
// The candidate rule is one function (`followupCandidates`), so a later round's
// automatic client reminder by due date can reuse the read and the claims.
import type { MetraDb } from '@metra/db';
import { cairoHour, todayInCairo, weekPeriodKey } from './clock';
import { daysWaiting, type InFlightDelivery } from './delivery-due-work';
import { claimAndNotifyFollowups, claimFollowupDay } from './delivery-followup-writes';
import { emailEachRecipient } from './email-delivery';
import { sharedInFlightDeliveries } from './org-tick-memo';
import type { AutomationDeps, AutomationResult } from './types';
import { withOrgContext } from '@/lib/db/context';
import { sendDeliveryFollowupEmail } from '@/lib/email/delivery-senders';
import { emailDeliveryLabel } from '@/lib/engagements/client-acts/email-label';

/** Deliveries followed up per org per Cairo day at most (A12). */
export const DELIVERY_FOLLOWUPS_PER_DAY = 10;

type WaitingDelivery = InFlightDelivery & { days: number };

/**
 * The client's move for at least `thresholdDays` since the wait began
 * (`waitingSince`, not the last write), the longest wait first.
 */
export function followupCandidates(
  deliveries: readonly InFlightDelivery[],
  thresholdDays: number,
  now: Date,
): WaitingDelivery[] {
  return deliveries
    .filter((delivery) => delivery.whoseMove === 'client')
    .map((delivery) => ({ ...delivery, days: daysWaiting(delivery, now) }))
    .filter((delivery) => delivery.days >= thresholdDays)
    .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
}

/** The year a delivery's DE-YYYY-NNNN shows: its creation year in Cairo (the notifier's rule). */
function cairoYear(createdAt: Date): number {
  return Number(todayInCairo(createdAt).slice(0, 4));
}

/** Claim, notify: the day's reminders inside the org's transaction. Null when the day is already claimed. */
async function remindToday(tx: MetraDb, deps: AutomationDeps) {
  const { ctx, settings, now } = deps;
  const week = weekPeriodKey(now);
  const day = await claimFollowupDay(tx, ctx.orgId, todayInCairo(now), week);
  if (!day.won) return null;
  const { deliveries, capped } = await sharedInFlightDeliveries(deps, tx);
  if (capped) console.info('delivery followups capped', { org: ctx.orgId, considered: deliveries.length });
  const picks = followupCandidates(deliveries, settings.followupThresholdDays, now)
    .filter((delivery) => !day.remindedThisWeek.has(delivery.id))
    .slice(0, DELIVERY_FOLLOWUPS_PER_DAY);
  const won = await claimAndNotifyFollowups(
    tx,
    ctx.orgId,
    week,
    picks.map(({ id, number, createdAt, titleAr, titleEn, days }) => ({
      engagementId: id,
      params: { number, year: cairoYear(createdAt), titleAr, titleEn, days },
    })),
    day.ownerIds,
  );
  return { reminded: picks.filter((delivery) => won.has(delivery.id)), ownerIds: day.ownerIds };
}

export async function runDeliveryFollowups(deps: AutomationDeps): Promise<AutomationResult> {
  const { ctx, settings, now, locale, appUrl } = deps;
  const result: AutomationResult = { automation: 'delivery', ran: false, effects: 0, emailsSent: 0, emailsFailed: 0 };
  if (!settings.followupEnabled || cairoHour(now) !== 7) return result;

  const won = await withOrgContext(ctx, (tx) => remindToday(tx, deps));
  if (!won) return result;
  result.ran = true;
  result.effects = won.reminded.length * won.ownerIds.length;
  if (won.reminded.length === 0) return result;

  const listed = won.reminded.map((delivery) => ({
    label: emailDeliveryLabel(
      { number: delivery.number, year: cairoYear(delivery.createdAt), titleAr: delivery.titleAr, titleEn: delivery.titleEn },
      locale,
    ),
    days: delivery.days,
  }));
  const deliveriesUrl = `${appUrl}/${locale}/engagements`;
  await emailEachRecipient(
    deps,
    won.ownerIds,
    (to) => sendDeliveryFollowupEmail({ to, deliveries: listed, deliveriesUrl, locale }),
    result,
  );
  return result;
}
