import 'server-only';
// Morning follow-ups on deliveries that wait on the client (Round C, C4). The
// studio is reminded, never the client (owner decision Q2: Metra sends no client
// message on its own): every owner and admin, the roles that may send the
// existing WhatsApp/email reminder, gets one notification per delivery and one
// email listing them. Reuses the quotation follow-up setting: "follow up when a
// client has not answered for N days" covers deliveries too.
//
// The candidate rule is one function (`followupCandidates`), so a later round's
// automatic client reminder by due date can reuse the read and the claims.
import { cairoHour, todayInCairo, weekPeriodKey } from './clock';
import { claimPeriod } from './claim';
import { inFlightDeliveries, type InFlightDelivery } from './delivery-due-work';
import { orgOwnerAdminIds } from './due-work';
import { countEmailOutcome, emailRecipient } from './email-delivery';
import type { AutomationDeps, AutomationResult } from './types';
import { withOrgContext } from '@/lib/db/context';
import { sendDeliveryFollowupEmail } from '@/lib/email/delivery-senders';
import { emailDeliveryLabel } from '@/lib/engagements/client-acts/email-label';
import { insertNotification } from '@/lib/notifications/core';

/** Deliveries followed up per org per Cairo day at most (A12). */
export const DELIVERY_FOLLOWUPS_PER_DAY = 10;

type WaitingDelivery = InFlightDelivery & { days: number };

/** Waiting on the client (or stalled there) for at least `thresholdDays`, oldest first. */
export function followupCandidates(deliveries: readonly InFlightDelivery[], thresholdDays: number): WaitingDelivery[] {
  return deliveries.flatMap((delivery) => {
    const { status } = delivery;
    const waiting = status.kind === 'waitingClient' || status.kind === 'stalled';
    return waiting && status.days >= thresholdDays ? [{ ...delivery, days: status.days }] : [];
  });
}

/** The year a delivery's DE-YYYY-NNNN shows: its creation year in Cairo (the notifier's rule). */
function cairoYear(createdAt: Date): number {
  return Number(todayInCairo(createdAt).slice(0, 4));
}

export async function runDeliveryFollowups(deps: AutomationDeps): Promise<AutomationResult> {
  const { ctx, settings, now, locale, appUrl, lookupRecipientEmail } = deps;
  const result: AutomationResult = { automation: 'delivery', ran: false, effects: 0, emailsSent: 0, emailsFailed: 0 };
  if (!settings.followupEnabled || cairoHour(now) !== 7) return result;

  const won = await withOrgContext(ctx, async (tx) => {
    if (!(await claimPeriod(tx, ctx.orgId, 'delivery', todayInCairo(now)))) return null;
    const { deliveries, capped } = await inFlightDeliveries(tx, ctx.role, now);
    if (capped) console.info('delivery followups capped', { org: ctx.orgId, considered: deliveries.length });
    const reminded: WaitingDelivery[] = [];
    for (const delivery of followupCandidates(deliveries, settings.followupThresholdDays)) {
      if (reminded.length === DELIVERY_FOLLOWUPS_PER_DAY) break;
      const week = `${delivery.id}:${weekPeriodKey(now)}`;
      if (await claimPeriod(tx, ctx.orgId, 'delivery-followup', week)) reminded.push(delivery);
    }
    const owners = reminded.length ? await orgOwnerAdminIds(tx) : [];
    for (const delivery of reminded) {
      const { id, number, titleAr, titleEn, days } = delivery;
      const params = { number, year: cairoYear(delivery.createdAt), titleAr, titleEn, days };
      for (const owner of owners) {
        await insertNotification(tx, ctx.orgId, {
          recipientUserId: owner.userId,
          kind: 'delivery_followup',
          entityType: 'engagement',
          entityId: id,
          bodyKey: 'delivery_waiting_on_client',
          params,
        });
        result.effects += 1;
      }
    }
    return { reminded, owners };
  });
  if (!won) return result;
  result.ran = true;
  if (won.reminded.length === 0) return result;

  const listed = won.reminded.map((delivery) => ({
    label: emailDeliveryLabel(
      { number: delivery.number, year: cairoYear(delivery.createdAt), titleAr: delivery.titleAr, titleEn: delivery.titleEn },
      locale,
    ),
    days: delivery.days,
  }));
  for (const owner of won.owners) {
    const outcome = await emailRecipient(lookupRecipientEmail, owner.userId, (to) =>
      sendDeliveryFollowupEmail({ to, deliveries: listed, deliveriesUrl: `${appUrl}/${locale}/engagements`, locale }),
    );
    countEmailOutcome(result, outcome);
  }
  return result;
}
