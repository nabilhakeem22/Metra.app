import 'server-only';
import { addDays, cairoHour, todayInCairo } from './clock';
import { claimPeriod } from './claim';
import { orgOwnerAdminIds, overdueStages, upcomingStages } from './due-work';
import { resolveUserEmail } from './recipients';
import type { AutomationDeps, AutomationResult } from './types';
import { withOrgContext } from '@/lib/db/context';
import { sendStageReminderEmail } from '@/lib/email/resend';
import { insertNotification } from '@/lib/notifications/core';

const UPCOMING_HORIZON_DAYS = 7;

/**
 * Daily stage reminders for owners/admins, gated to the 07:00 Cairo send hour and
 * claimed once per Cairo day. Counts stages past their end date (overdue) and due
 * within the horizon (upcoming); when either is non-zero, notifies every
 * owner/admin and best-effort emails each. No client contact.
 */
export async function runStageReminders(
  deps: AutomationDeps,
): Promise<AutomationResult> {
  const { ctx, settings, now, locale, appUrl } = deps;
  const result: AutomationResult = {
    automation: 'stage',
    ran: false,
    effects: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
  if (!settings.stageRemindersEnabled) return result;
  if (cairoHour(now) !== 7) return result;

  const today = todayInCairo(now);
  const horizon = addDays(today, UPCOMING_HORIZON_DAYS);

  const won = await withOrgContext(ctx, async (tx) => {
    const claimed = await claimPeriod(tx, ctx.orgId, 'stage', today);
    if (!claimed) return null;
    const [overdue, upcoming, owners] = await Promise.all([
      overdueStages(tx, today),
      upcomingStages(tx, today, horizon),
      orgOwnerAdminIds(tx),
    ]);
    if (overdue.length === 0 && upcoming.length === 0) {
      return { owners: [], overdueCount: 0, upcomingCount: 0 };
    }
    for (const o of owners) {
      await insertNotification(tx, ctx.orgId, {
        recipientUserId: o.userId,
        kind: 'stage_reminder',
        bodyKey: 'stage_reminder',
        params: { overdueCount: overdue.length, upcomingCount: upcoming.length },
      });
      result.effects += 1;
    }
    return {
      owners,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
    };
  });
  if (!won) return result;
  result.ran = true;

  for (const o of won.owners) {
    const email = await resolveUserEmail(o.userId);
    if (!email) continue;
    const { sent } = await sendStageReminderEmail({
      to: email,
      overdueCount: won.overdueCount,
      upcomingCount: won.upcomingCount,
      projectsUrl: `${appUrl}/${locale}/projects`,
      locale,
    });
    if (sent) result.emailsSent += 1;
    else result.emailsFailed += 1;
  }

  return result;
}
