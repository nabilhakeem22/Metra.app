import 'server-only';
import { daysBetween, todayInCairo } from './clock';
import { claimPeriod } from './claim';
import { dueForFollowup } from './due-work';
import { resolveUserEmail } from './recipients';
import type { AutomationDeps, AutomationResult } from './types';
import { withOrgContext } from '@/lib/db/context';
import { sendFollowupReminderEmail } from '@/lib/email/resend';
import { insertNotification } from '@/lib/notifications/core';

/**
 * For each `sent` (not-yet-accepted) proposal idle longer than the org threshold,
 * notify the ORIGINAL SENDER (fallback: the system actor) and best-effort email
 * them. Re-nudges once per N-day window (windowIndex = floor(age / threshold)) so
 * a lingering proposal is chased again, never twice for the same window. The
 * recipient is always an internal user — never the client (HUMAN-IN-THE-LOOP).
 */
export async function runFollowupReminders(
  deps: AutomationDeps,
): Promise<AutomationResult> {
  const { ctx, settings, now, locale, appUrl } = deps;
  const result: AutomationResult = {
    automation: 'followup',
    ran: false,
    effects: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
  if (!settings.followupEnabled) return result;

  const today = todayInCairo(now);
  const threshold = settings.followupThresholdDays;

  const candidates = await withOrgContext(ctx, (tx) => dueForFollowup(tx));
  result.ran = true;

  for (const c of candidates) {
    const age = daysBetween(todayInCairo(c.sentAt), today);
    if (age < threshold) continue;
    const windowIndex = Math.floor(age / threshold);
    const recipient = c.senderUserId ?? ctx.userId;

    const won = await withOrgContext(ctx, async (tx) => {
      const claimed = await claimPeriod(
        tx,
        ctx.orgId,
        'followup',
        `${c.id}:${windowIndex}`,
      );
      if (!claimed) return false;
      await insertNotification(tx, ctx.orgId, {
        recipientUserId: recipient,
        kind: 'followup_reminder',
        entityType: 'proposal',
        entityId: c.id,
        bodyKey: 'proposal_followup',
        params: { number: c.number, days: age },
      });
      result.effects += 1;
      return true;
    });
    if (!won) continue;

    const email = await resolveUserEmail(recipient);
    if (!email) continue;
    const { sent } = await sendFollowupReminderEmail({
      to: email,
      proposalNumber: String(c.number),
      days: age,
      reviewUrl: `${appUrl}/${locale}/proposals/${c.id}`,
      locale,
    });
    if (sent) result.emailsSent += 1;
    else result.emailsFailed += 1;
  }

  return result;
}
